import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '../../common/logger/logger.service';
import { ErrorMessages, SuccessMessages, MatchingStatus, CandidateDriverStatus, OfferStatus, DRIVER_RESPONSE_TIMEOUT_MS } from '../../common/constants';
import { Matching, MatchingDocument, Offer, OfferDocument } from './schemas';
import { RequestMatchDto, FinalizeMatchDto } from './dto';
import { GeoClientService } from './clients/geoClient.service';
import { DriverClientService } from './clients/driverClient.service';
import { TripClientService } from './clients/tripClient.service';

@Injectable()
export class MatchingService {
  private nearbyCache = new Map<string, { expiresAt: number; drivers: any[] }>();

  constructor(
    @InjectModel(Matching.name)
    private matchingModel: Model<MatchingDocument>,
    @InjectModel(Offer.name)
    private offerModel: Model<OfferDocument>,
    private readonly logger: LoggerService,
    private readonly geoClient: GeoClientService,
    private readonly driverClient: DriverClientService,
    private readonly tripClient: TripClientService,
  ) {}

  async requestMatch(data: RequestMatchDto) {
    this.logger.log(`Requesting match for ride: ${data.rideRequestId}`, 'Matching Service - requestMatch');

    const matchingId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const nearbyDrivers = await this.getNearbyDriversWithCache(data);

    let effectiveNearby = nearbyDrivers;
    const maxRetries = Number(process.env.MATCHING_MAX_RADIUS_RETRIES || 3);
    const radiusIncrement = Number(process.env.MATCHING_RADIUS_INCREMENT_METERS || 500);
    
    let currentRadius = data.radiusInMeters;
    let retries = 0;

    while ((!effectiveNearby || effectiveNearby.length === 0) && retries < maxRetries) {
      retries++;
      currentRadius += radiusIncrement;
      
      this.logger.log(
        `No drivers found, expanding radius to ${currentRadius}m (Retry ${retries}/${maxRetries})`, 
        'Matching Service - requestMatch'
      );
      
      effectiveNearby = await this.getNearbyDriversWithCache({
        ...data,
        radiusInMeters: currentRadius,
      });
    }
    
    if (!effectiveNearby || effectiveNearby.length === 0) {
      await this.tripClient.cancelTrip(data.rideRequestId, 'no_drivers_nearby');
      throw new BadRequestException(ErrorMessages.NO_DRIVERS_AVAILABLE);
    }

    const areaId = data.areaId?.trim() || 'DEFAULT';
    const cityCode = data.cityCode?.trim() || 'DEFAULT';

    //Ranking Drivers based on Distance , ETA , Driver rating etc
    const rankedDrivers = await this.rankCandidateDrivers(effectiveNearby);

    const matching = await this.matchingModel.create({
      matchingId,
      rideRequestId: data.rideRequestId,
      areaId,
      cityCode,
      candidateDrivers: rankedDrivers.map((driver) => ({
        driverId: driver.driverId,
        distanceInMeters: driver.distanceInMeters,
        etaInMinutes: driver.etaInMinutes,
        status: CandidateDriverStatus.QUEUED,
        rankingScore: driver.rankingScore,
        acceptanceProbability: driver.acceptanceProbability,
        driverRating: driver.driverRating,
        cancellationRate: driver.cancellationRate,
        responseTimeScore: driver.responseTimeScore,
      })),
      selectedDriver: null,
      status: MatchingStatus.PENDING,
    });

    this.startParallelMatching(matchingId, matching.candidateDrivers, data.rideRequestId);

    return {
      matchingId,
      rideRequestId: data.rideRequestId,
      candidateDrivers: matching.candidateDrivers,
      status: matching.status,
      matchingMode: 'parallel',
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

    const driverIds = nearbyDrivers.map((d: any) => d.driverId).join(', ');
    this.logger.log(
      `Received nearby drivers for trip ${data.rideRequestId || 'UNKNOWN'}: count=${nearbyDrivers.length}, ids=[${driverIds}]`,
      'Matching Service - getNearbyDriversWithCache',
    );

    const ttlMs = Number(process.env.MATCHING_NEARBY_CACHE_TTL_MS || 15000);
    this.nearbyCache.set(key, { expiresAt: now + ttlMs, drivers: nearbyDrivers });
    return nearbyDrivers;
  }

  /**
   * Ranks candidate drivers based on a weighted scoring system:
   * - 45% Distance: Proximity to the rider (closer is better, up to 10km)
   * - 25% Rating: Driver's historical rating (out of 5)
   * - 15% Cancellation Rate: Inverse of historical cancellations (fewer cancellations is better)
   * - 15% Response Time: Historical responsiveness (higher score is better)
   */
  private async rankCandidateDrivers(nearbyDrivers: Array<any>) {
    // simplified for brevity in this rewrite, same logic as before
    const ranked = await Promise.all(
      nearbyDrivers.map(async (driver) => {
        const historical = await this.getDriverHistoricalHeuristics(driver.driverId);
        const distanceScore = Math.max(0, 1 - Math.min(driver.distanceInMeters, 10000) / 10000);
        const ratingScore = Math.min(Math.max(historical.driverRating, 0), 5) / 5;
        const cancellationScore = 1 - Math.min(Math.max(historical.cancellationRate, 0), 1);
        const responseTimeScore = Math.min(Math.max(historical.responseTimeScore, 0), 1);

        const rankingScore = 0.45 * distanceScore + 0.25 * ratingScore + 0.15 * cancellationScore + 0.15 * responseTimeScore;
        
        // Acceptance probability starts with a 20% base chance (0.2).
        // It heavily weighs the driver's rating (35%) and cancellation history (20%),
        // while response time (15%) and distance (10%) have a smaller impact.
        const acceptanceProbability = Math.min(0.95, Math.max(0.05, 0.2 + 0.35 * ratingScore + 0.2 * cancellationScore + 0.15 * responseTimeScore + 0.1 * distanceScore));

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

  private async getDriverHistoricalHeuristics(driverId: string) {
    const deterministicBias = (Math.abs(this.hashCode(driverId)) % 70) / 100;
    const driverRating = Math.round((3.8 + deterministicBias) * 10) / 10;
    return {
      driverRating,
      cancellationRate: 0.12,
      responseTimeScore: 0.8,
    };
  }

  private hashCode(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return hash;
  }

  private async startParallelMatching(
    matchingId: string,
    candidateDrivers: Array<any>,
    rideRequestId: string,
  ) {
    const availability = await Promise.all(
      candidateDrivers.map(async (driver) => {
        try {
          const status = await this.driverClient.getDriverStatus(driver.driverId);
          return { driverId: driver.driverId, online: status?.status === 'ONLINE' };
        } catch {
          return { driverId: driver.driverId, online: false };
        }
      }),
    );

    const onlineDriverIds = availability.filter((a) => a.online).map((a) => a.driverId);
    
    // Create offers for all parallel drivers
    const offerPromises = onlineDriverIds.map(async (id) => {
      const offerId = `offer_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      await this.offerModel.create({
        offerId,
        matchingId,
        tripId: rideRequestId,
        driverId: id,
        status: OfferStatus.PENDING,
        expiresAt: new Date(Date.now() + Number(process.env.OFFER_ACCEPTANCE_TIMEOUT_MS || 30000)),
      });
      await this.updateDriverStatus(matchingId, id, CandidateDriverStatus.PENDING);
      return offerId;
    });
    
    const parallelOfferIds = await Promise.all(offerPromises);
    const acceptedOfferId = await this.waitForAnyOfferAcceptance(parallelOfferIds);
    
    if (acceptedOfferId) {
      // It's finalized already inside acceptOffer
      return;
    }

    await Promise.all(
      onlineDriverIds.map((id) => this.updateDriverStatus(matchingId, id, CandidateDriverStatus.TIMEOUT)),
    );
    
    await this.matchingModel.findOneAndUpdate(
      { matchingId },
      { status: MatchingStatus.REJECTED },
    );

    // If no driver accepts the request within the given time, the offer is expired
    // and matching is rejected, we need to mark the trip also as rejected
    await this.tripClient.rejectTrip(rideRequestId);
  }

  private async waitForAnyOfferAcceptance(offerIds: string[]): Promise<string | null> {
    if (offerIds.length === 0) return null;
    const timeoutMs = Number(process.env.OFFER_ACCEPTANCE_TIMEOUT_MS || 30000);
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const acceptedOffer = await this.offerModel.findOne({ 
        offerId: { $in: offerIds },
        status: OfferStatus.ACCEPTED 
      }).lean();
      
      if (acceptedOffer) {
        return acceptedOffer.offerId;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    
    // Expire remaining offers
    await this.offerModel.updateMany(
      { offerId: { $in: offerIds }, status: OfferStatus.PENDING },
      { $set: { status: OfferStatus.EXPIRED } }
    );
    
    return null;
  }



  async acceptOffer(offerId: string) {
    // Atomically find a PENDING offer that hasn't expired and mark it ACCEPTED
    const offer = await this.offerModel.findOneAndUpdate(
      { 
        offerId, 
        status: OfferStatus.PENDING,
        expiresAt: { $gt: new Date() }
      },
      { 
        $set: { 
          status: OfferStatus.ACCEPTED, 
          acceptedAt: new Date() 
        } 
      },
      { new: true }
    );

    if (!offer) {
      throw new BadRequestException('Offer expired, invalid, or already processed');
    }

    // Update matching document candidate list
    await this.updateDriverStatus(offer.matchingId, offer.driverId.toString(), CandidateDriverStatus.ACCEPTED);

    // Finalize match internally (calls Trip Service for final atomic assignment)
    await this.finalizeMatchInternal(offer.matchingId, offer.driverId.toString(), offer.tripId);
    return offer;
  }

  async rejectOffer(offerId: string) {
    // Atomically reject
    const offer = await this.offerModel.findOneAndUpdate(
      { offerId, status: OfferStatus.PENDING },
      { $set: { status: OfferStatus.REJECTED, rejectedAt: new Date() } },
      { new: true }
    );

    if (!offer) {
      throw new BadRequestException('Offer expired, invalid, or already processed');
    }

    // Update matching document candidate list
    await this.updateDriverStatus(offer.matchingId, offer.driverId.toString(), CandidateDriverStatus.REJECTED);

    return offer;
  }

  private async finalizeMatchInternal(matchingId: string, driverId: string, rideRequestId: string) {
    this.logger.log(`Finalizing match internally: ${matchingId} with driver ${driverId}`, 'Matching Service');

    try {
      await this.tripClient.assignTripToDriver(rideRequestId, driverId);
    } catch (error) {
      this.logger.error(`Error assigning trip to driver: ${error.message}`, error.stack, 'Matching Service');
      throw error;
    }

    await this.matchingModel.findOneAndUpdate(
      { matchingId },
      {
        status: MatchingStatus.FINALIZED,
        selectedDriver: driverId,
      },
    );
  }

  private async updateDriverStatus(matchingId: string, driverId: string, status: string) {
    await this.matchingModel.findOneAndUpdate(
      { matchingId, 'candidateDrivers.driverId': driverId },
      {
        $set: {
          'candidateDrivers.$.status': status,
          'candidateDrivers.$.requestedAt': status === CandidateDriverStatus.PENDING ? new Date() : undefined,
        },
      },
    );
  }

  // Legacy methods (Stubbed)
  async handleDriverResponse(data: any) {
    throw new BadRequestException('Use acceptOffer or rejectOffer endpoints instead.');
  }

  async finalizeMatch(data: any) {
    throw new BadRequestException('Match finalization happens automatically upon offer acceptance.');
  }

  async countPendingMatchesByArea(areaId: string): Promise<number> {
    const id = areaId?.trim() || 'DEFAULT';
    const statusFilter = {
      status: { $in: [MatchingStatus.PENDING, MatchingStatus.ACCEPTED] },
    };

    if (id === 'DEFAULT') {
      return this.matchingModel.countDocuments({
        ...statusFilter,
        $or: [{ areaId: 'DEFAULT' }, { areaId: { $exists: false } }, { areaId: null }, { areaId: '' }],
      });
    }

    return this.matchingModel.countDocuments({
      ...statusFilter,
      areaId: id,
    });
  }
}
