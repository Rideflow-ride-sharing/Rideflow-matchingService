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
  private nearbyCache = new Map<string, { expiresAt: number; drivers: any[] }>();

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

    // Find nearby drivers from Geo Service (cached for short TTL)
    const nearbyDrivers = await this.getNearbyDriversWithCache(data);

    let effectiveNearby = nearbyDrivers;
    if (!effectiveNearby || effectiveNearby.length === 0) {
      // Fallback strategy: optionally retry once with expanded radius.
      const expansion = Number(process.env.MATCHING_RADIUS_EXPANSION_FACTOR || 1.5);
      if (expansion > 1) {
        const retryRadius = Math.round(data.radiusInMeters * expansion);
        this.logger.warn(
          `No drivers found, retrying matching with expanded radius ${retryRadius}m`,
          'Matching Service - requestMatch',
        );
        effectiveNearby = await this.getNearbyDriversWithCache({
          ...data,
          radiusInMeters: retryRadius,
        });
      }
    }
    if (!effectiveNearby || effectiveNearby.length === 0) {
      throw new BadRequestException(ErrorMessages.NO_DRIVERS_AVAILABLE);
    }

    const areaId = data.areaId?.trim() || 'DEFAULT';
    const cityCode = data.cityCode?.trim() || 'DEFAULT';

    const rankedDrivers = await this.rankCandidateDrivers(effectiveNearby);
    const matchingMode = data.matchingMode === 'parallel' ? 'parallel' : 'sequential';

    // Create matching record
    const matching = await this.matchingModel.create({
      matchingId,
      rideRequestId: data.rideRequestId,
      areaId,
      cityCode,
      candidateDrivers: rankedDrivers.map((driver) => ({
        driverId: driver.driverId,
        distanceInMeters: driver.distanceInMeters,
        etaInMinutes: driver.etaInMinutes,
        status: 'queued',
        rankingScore: driver.rankingScore,
        acceptanceProbability: driver.acceptanceProbability,
        driverRating: driver.driverRating,
        cancellationRate: driver.cancellationRate,
        responseTimeScore: driver.responseTimeScore,
      })),
      selectedDriver: null,
      status: MatchingStatus.PENDING,
    });

    if (matchingMode === 'parallel') {
      this.startParallelThenSequentialMatching(matchingId, matching.candidateDrivers, data.rideRequestId);
    } else {
      this.startSequentialMatching(matchingId, matching.candidateDrivers, data.rideRequestId);
    }

    return {
      matchingId,
      rideRequestId: data.rideRequestId,
      candidateDrivers: matching.candidateDrivers,
      status: matching.status,
      matchingMode,
    };
  }

  private async getNearbyDriversWithCache(data: RequestMatchDto): Promise<any[]> {
    const key = `${data.latitude.toFixed(4)}:${data.longitude.toFixed(4)}:${Math.round(data.radiusInMeters)}`;
    const now = Date.now();
    const cached = this.nearbyCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.drivers;
    }

    const nearbyDrivers = await this.geoClient.findNearbyDrivers({
      latitude: data.latitude,
      longitude: data.longitude,
      radiusInMeters: data.radiusInMeters,
      limit: 10,
    });

    const ttlMs = Number(process.env.MATCHING_NEARBY_CACHE_TTL_MS || 15000);
    this.nearbyCache.set(key, { expiresAt: now + ttlMs, drivers: nearbyDrivers });
    return nearbyDrivers;
  }

  private async rankCandidateDrivers(
    nearbyDrivers: Array<{ driverId: string; distanceInMeters: number; etaInMinutes: number }>,
  ) {
    const ranked = await Promise.all(
      nearbyDrivers.map(async (driver) => {
        const historical = await this.getDriverHistoricalHeuristics(driver.driverId);
        const distanceScore = Math.max(0, 1 - Math.min(driver.distanceInMeters, 10000) / 10000); // 0..1
        const ratingScore = Math.min(Math.max(historical.driverRating, 0), 5) / 5; // 0..1
        const cancellationScore = 1 - Math.min(Math.max(historical.cancellationRate, 0), 1); // 0..1
        const responseTimeScore = Math.min(Math.max(historical.responseTimeScore, 0), 1); // 0..1

        // Weighted blend for ranking
        const rankingScore =
          0.45 * distanceScore +
          0.25 * ratingScore +
          0.15 * cancellationScore +
          0.15 * responseTimeScore;

        // Basic acceptance probability heuristic (bounded 0.05..0.95)
        const acceptanceProbability = Math.min(
          0.95,
          Math.max(
            0.05,
            0.2 + 0.35 * ratingScore + 0.2 * cancellationScore + 0.15 * responseTimeScore + 0.1 * distanceScore,
          ),
        );

        return {
          ...driver,
          rankingScore: Math.round(rankingScore * 1000) / 1000,
          acceptanceProbability: Math.round(acceptanceProbability * 1000) / 1000,
          driverRating: historical.driverRating,
          cancellationRate: historical.cancellationRate,
          responseTimeScore: historical.responseTimeScore,
        };
      }),
    );

    ranked.sort((a, b) => {
      if (b.rankingScore !== a.rankingScore) return b.rankingScore - a.rankingScore;
      return a.distanceInMeters - b.distanceInMeters;
    });
    return ranked;
  }

  private async getDriverHistoricalHeuristics(driverId: string): Promise<{
    driverRating: number;
    cancellationRate: number;
    responseTimeScore: number;
  }> {
    const history = await this.matchingModel.find({ 'candidateDrivers.driverId': driverId }).limit(30).lean();
    let offered = 0;
    let cancelledOrTimeout = 0;
    let responseMsTotal = 0;
    let responseCount = 0;

    for (const match of history) {
      const candidate = match.candidateDrivers?.find((c) => c.driverId === driverId);
      if (!candidate) continue;
      offered += 1;
      if (candidate.status === 'rejected' || candidate.status === 'timeout') {
        cancelledOrTimeout += 1;
      }
      if (candidate.requestedAt && candidate.respondedAt) {
        const diff = new Date(candidate.respondedAt).getTime() - new Date(candidate.requestedAt).getTime();
        if (diff > 0) {
          responseMsTotal += diff;
          responseCount += 1;
        }
      }
    }

    const avgResponseMs = responseCount > 0 ? responseMsTotal / responseCount : 12000;
    const responseTimeScore = Math.max(0, 1 - Math.min(avgResponseMs, 15000) / 15000);
    const cancellationRate = offered > 0 ? cancelledOrTimeout / offered : 0.12;

    // No explicit rating service currently wired; this deterministic baseline keeps ranking stable.
    const deterministicBias = (Math.abs(this.hashCode(driverId)) % 70) / 100; // 0..0.69
    const driverRating = Math.round((3.8 + deterministicBias) * 10) / 10; // 3.8..4.5

    return {
      driverRating,
      cancellationRate: Math.round(cancellationRate * 1000) / 1000,
      responseTimeScore: Math.round(responseTimeScore * 1000) / 1000,
    };
  }

  private hashCode(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return hash;
  }

  private async startParallelThenSequentialMatching(
    matchingId: string,
    candidateDrivers: Array<{ driverId: string; distanceInMeters: number; etaInMinutes: number; status: string }>,
    rideRequestId: string,
  ) {
    const batchSize = Number(process.env.MATCHING_PARALLEL_BATCH_SIZE || 3);
    const topBatch = candidateDrivers.slice(0, batchSize);
    const remainder = candidateDrivers.slice(batchSize);

    this.logger.log(
      `Starting parallel matching for top ${topBatch.length}, then sequential fallback for ${remainder.length}`,
      'Matching Service - startParallelThenSequentialMatching',
    );

    const availability = await Promise.all(
      topBatch.map(async (driver) => {
        try {
          const status = await this.driverClient.getDriverStatus(driver.driverId);
          return { driverId: driver.driverId, online: status?.status === 'ONLINE' };
        } catch {
          return { driverId: driver.driverId, online: false };
        }
      }),
    );

    const onlineDriverIds = availability.filter((a) => a.online).map((a) => a.driverId);
    await Promise.all(
      onlineDriverIds.map((id) => this.updateDriverStatus(matchingId, id, 'pending')),
    );

    const accepted = await this.waitForAnyDriverAcceptance(matchingId, onlineDriverIds);
    if (accepted) {
      await this.finalizeMatchInternal(matchingId, accepted, rideRequestId);
      return;
    }

    await Promise.all(
      onlineDriverIds.map((id) => this.updateDriverStatus(matchingId, id, 'timeout')),
    );
    await this.startSequentialMatching(matchingId, remainder, rideRequestId);
  }

  private async waitForAnyDriverAcceptance(
    matchingId: string,
    driverIds: string[],
  ): Promise<string | null> {
    if (driverIds.length === 0) return null;
    const timeoutMs = DRIVER_RESPONSE_TIMEOUT_MS;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const matching = await this.matchingModel.findOne({ matchingId }).lean();
      if (!matching || matching.status === MatchingStatus.FINALIZED) {
        return matching?.selectedDriver || null;
      }

      const accepted = matching.candidateDrivers?.find(
        (d) => driverIds.includes(d.driverId) && d.status === 'accepted',
      );
      if (accepted?.driverId) {
        return accepted.driverId;
      }

      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    return null;
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

  async countPendingMatchesByArea(areaId: string): Promise<number> {
    const id = areaId?.trim() || 'DEFAULT';
    const statusFilter = {
      status: { $in: [MatchingStatus.PENDING, MatchingStatus.ACCEPTED] },
    };

    // Legacy docs may omit areaId; treat those as DEFAULT for demand counting.
    if (id === 'DEFAULT') {
      return this.matchingModel.countDocuments({
        ...statusFilter,
        $or: [
          { areaId: 'DEFAULT' },
          { areaId: { $exists: false } },
          { areaId: null },
          { areaId: '' },
        ],
      });
    }

    return this.matchingModel.countDocuments({
      ...statusFilter,
      areaId: id,
    });
  }
}




