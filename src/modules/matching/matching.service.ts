import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '../../common/logger/logger.service';
import { ErrorMessages, SuccessMessages, MatchingStatus, DRIVER_RESPONSE_TIMEOUT_MS } from '../../common/constants';
import { Matching, MatchingDocument } from './schemas';
import { RequestMatchDto, DriverResponseDto, FinalizeMatchDto } from './dto';
import { GeoClientService } from './clients/geoClient.service';
import { DriverClientService } from './clients/driverClient.service';

@Injectable()
export class MatchingService {
  private activeMatchingTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    @InjectModel(Matching.name)
    private matchingModel: Model<MatchingDocument>,
    private readonly logger: LoggerService,
    private readonly geoClient: GeoClientService,
    private readonly driverClient: DriverClientService,
  ) {}

  async requestMatch(data: RequestMatchDto) {

    this.logger.log(
      `Requesting match for ride: ${data.rideRequestId}`,
      'Matching Service - requestMatch',
    );

    // Generate matching ID
    const matchingId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Find nearby drivers from Geo Service
    const nearbyDrivers = await this.geoClient.findNearbyDrivers({
      latitude: data.latitude,
      longitude: data.longitude,
      radiusInMeters: data.radiusInMeters,
      limit: 10,
    });

    if (!nearbyDrivers || nearbyDrivers.length === 0) {
      throw new BadRequestException(ErrorMessages.NO_DRIVERS_AVAILABLE);
    }

    // Create matching record
    const matching = await this.matchingModel.create({
      matchingId,
      rideRequestId: data.rideRequestId,
      candidateDrivers: nearbyDrivers.map((driver) => ({
        driverId: driver.driverId,
        distanceInMeters: driver.distanceInMeters,
        etaInMinutes: driver.etaInMinutes,
        status: 'pending',
      })),
      selectedDriver: null,
      status: MatchingStatus.PENDING,
    });

    // Start sequential driver matching process
    this.startSequentialMatching(matchingId, matching.candidateDrivers, data.rideRequestId);

    return {
      matchingId,
      rideRequestId: data.rideRequestId,
      candidateDrivers: matching.candidateDrivers,
      status: matching.status,
    };
  }

  private async startSequentialMatching(
    matchingId: string,
    candidateDrivers: Array<{ driverId: string; distanceInMeters: number; etaInMinutes: number; status: string }>,
    rideRequestId: string,
  ) {

    this.logger.log(
      `Starting sequential matching for ${candidateDrivers.length} drivers`,
      'Matching Service - startSequentialMatching',
    );

    for (const driver of candidateDrivers) {
      // Check if matching is already finalized
      const matching = await this.matchingModel.findOne({ matchingId });
      if (!matching || matching.status === MatchingStatus.FINALIZED) {
        this.logger.log(
          `Matching ${matchingId} already finalized, stopping`,
          'Matching Service - startSequentialMatching',
        );
        return;
      }

      // Check if driver is still available
      try {
        const driverStatus = await this.driverClient.getDriverStatus(driver.driverId);
        if (driverStatus?.status !== 'ONLINE') {
          this.logger.log(
            `Driver ${driver.driverId} is not ONLINE, skipping`,
            'Matching Service - startSequentialMatching',
          );
          await this.updateDriverStatus(matchingId, driver.driverId, 'rejected');
          continue;
        }
      } catch (error) {
        this.logger.warn(
          `Error checking driver status: ${driver.driverId}, skipping`,
          'Matching Service - startSequentialMatching',
        );
        await this.updateDriverStatus(matchingId, driver.driverId, 'rejected');
        continue;
      }

      // Update driver status to pending
      await this.updateDriverStatus(matchingId, driver.driverId, 'pending');

      // Wait for driver response with timeout
      const responseReceived = await this.waitForDriverResponse(matchingId, driver.driverId, rideRequestId);

      if (responseReceived) {
        // Driver responded, check if accepted
        const updatedMatching = await this.matchingModel.findOne({ matchingId });
        const driverCandidate = updatedMatching?.candidateDrivers.find((d) => d.driverId === driver.driverId);

        if (driverCandidate?.status === 'accepted') {
          // Driver accepted, finalize the match
          await this.finalizeMatchInternal(matchingId, driver.driverId, rideRequestId);
          return;
        }
        // Driver rejected, continue to next driver
      } else {
        // Timeout, mark as timeout and continue
        await this.updateDriverStatus(matchingId, driver.driverId, 'timeout');
      }
    }

    // No driver accepted, mark matching as rejected
    await this.matchingModel.findOneAndUpdate(
      { matchingId },
      { status: MatchingStatus.REJECTED },
    );

    this.logger.log(
      `No driver accepted for matching ${matchingId}`,
      'Matching Service - startSequentialMatching',
    );
  }

  private async waitForDriverResponse(
    matchingId: string,
    driverId: string,
    rideRequestId: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(async () => {
        this.activeMatchingTimers.delete(`${matchingId}_${driverId}`);
        resolve(false);
      }, DRIVER_RESPONSE_TIMEOUT_MS);

      this.activeMatchingTimers.set(`${matchingId}_${driverId}`, timeout);

      // Check periodically if response was received
      const checkInterval = setInterval(async () => {
        const matching = await this.matchingModel.findOne({ matchingId });
        const driverCandidate = matching?.candidateDrivers.find((d) => d.driverId === driverId);

        if (driverCandidate?.status === 'accepted' || driverCandidate?.status === 'rejected') {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          this.activeMatchingTimers.delete(`${matchingId}_${driverId}`);
          resolve(true);
        }
      }, 500); // Check every 500ms

      // Clean up interval after timeout
      setTimeout(() => {
        clearInterval(checkInterval);
      }, DRIVER_RESPONSE_TIMEOUT_MS);
    });
  }

  async handleDriverResponse(data: DriverResponseDto) {

    this.logger.log(
      `Driver response received: ${JSON.stringify(data)}`,
      'Matching Service - handleDriverResponse',
    );

    const matching = await this.matchingModel.findOne({ matchingId: data.matchingId });

    if (!matching) {
      throw new NotFoundException(ErrorMessages.MATCHING_NOT_FOUND);
    }

    if (matching.status === MatchingStatus.FINALIZED) {
      throw new ConflictException(ErrorMessages.MATCHING_ALREADY_FINALIZED);
    }

    // Update driver status
    const driverIndex = matching.candidateDrivers.findIndex((d) => d.driverId === data.driverId);
    if (driverIndex === -1) {
      throw new NotFoundException('Driver not found in candidate list');
    }

    const newStatus = data.accepted ? 'accepted' : 'rejected';
    matching.candidateDrivers[driverIndex].status = newStatus;
    matching.candidateDrivers[driverIndex].respondedAt = new Date();

    if (data.accepted) {
      matching.status = MatchingStatus.ACCEPTED;
      matching.selectedDriver = data.driverId;
    }

    await matching.save();

    // Clear timeout if exists
    const timerKey = `${data.matchingId}_${data.driverId}`;
    const timeout = this.activeMatchingTimers.get(timerKey);
    if (timeout) {
      clearTimeout(timeout);
      this.activeMatchingTimers.delete(timerKey);
    }

    // If accepted, finalize immediately
    if (data.accepted) {
      await this.finalizeMatchInternal(data.matchingId, data.driverId, matching.rideRequestId);
    }

    return {
      matchingId: data.matchingId,
      driverId: data.driverId,
      accepted: data.accepted,
      status: matching.status,
    };
  }

  async finalizeMatch(data: FinalizeMatchDto) {

    this.logger.log(
      `Finalizing match: ${data.matchingId}`,
      'Matching Service - finalizeMatch',
    );

    const matching = await this.matchingModel.findOne({ matchingId: data.matchingId });

    if (!matching) {
      throw new NotFoundException(ErrorMessages.MATCHING_NOT_FOUND);
    }

    if (matching.status === MatchingStatus.FINALIZED) {
      return {
        matchingId: data.matchingId,
        selectedDriver: matching.selectedDriver,
        status: matching.status,
      };
    }

    if (!matching.selectedDriver) {
      throw new BadRequestException('No driver selected for this matching');
    }

    await this.finalizeMatchInternal(data.matchingId, matching.selectedDriver, matching.rideRequestId);

    const updatedMatching = await this.matchingModel.findOne({ matchingId: data.matchingId });

    return {
      matchingId: data.matchingId,
      selectedDriver: updatedMatching?.selectedDriver,
      status: updatedMatching?.status,
    };
  }

  private async finalizeMatchInternal(matchingId: string, driverId: string, rideRequestId: string) {

    this.logger.log(
      `Finalizing match internally: ${matchingId} with driver ${driverId}`,
      'Matching Service - finalizeMatchInternal',
    );

    // Assign trip to driver
    try {
      await this.driverClient.assignTrip(driverId, rideRequestId);
    } catch (error) {
      this.logger.error(
        `Error assigning trip to driver: ${error.message}`,
        error.stack,
        'Matching Service - finalizeMatchInternal',
      );
      throw error;
    }

    // Update matching status
    await this.matchingModel.findOneAndUpdate(
      { matchingId },
      {
        status: MatchingStatus.FINALIZED,
        selectedDriver: driverId,
      },
    );

    this.logger.log(
      `Match finalized: ${matchingId} with driver ${driverId}`,
      'Matching Service - finalizeMatchInternal',
    );
  }

  private async updateDriverStatus(matchingId: string, driverId: string, status: string) {
    await this.matchingModel.findOneAndUpdate(
      { matchingId, 'candidateDrivers.driverId': driverId },
      {
        $set: {
          'candidateDrivers.$.status': status,
          'candidateDrivers.$.requestedAt': status === 'pending' ? new Date() : undefined,
        },
      },
    );
  }
}




