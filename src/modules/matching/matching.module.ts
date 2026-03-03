import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import { LoggerService } from '../../common/logger/logger.service';
import { GeoClientService } from './clients/geoClient.service';
import { DriverClientService } from './clients/driverClient.service';
import { Matching, MatchingSchema } from './schemas';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Matching.name, schema: MatchingSchema },
    ]),
  ],
  controllers: [MatchingController],
  providers: [MatchingService, LoggerService, GeoClientService, DriverClientService],
  exports: [MatchingService],
})
export class MatchingModule {}




