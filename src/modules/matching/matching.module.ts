import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import { LoggerService } from '../../common/logger/logger.service';
import { GeoClientService } from './clients/geoClient.service';
import { DriverClientService } from './clients/driverClient.service';
import { TripClientService } from './clients/tripClient.service';
import { Matching, MatchingSchema, Offer, OfferSchema } from './schemas';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Matching.name, schema: MatchingSchema },
      { name: Offer.name, schema: OfferSchema },
    ]),
  ],
  controllers: [MatchingController],
  providers: [MatchingService, LoggerService, GeoClientService, DriverClientService, TripClientService],
  exports: [MatchingService],
})
export class MatchingModule {}




