import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, RpcException } from '@nestjs/microservices';
import { MatchingService } from './matching.service';
import { LoggerService } from '../../common/logger/logger.service';
import { commands } from '../../common/constants/commands';
import { ErrorMessages, SuccessMessages } from '../../common/constants';
import { RequestMatchDto, DriverResponseDto, FinalizeMatchDto, AcceptOfferDto, RejectOfferDto } from './dto';

@Controller()
export class MatchingController {
  constructor(
    private readonly logger: LoggerService,
    private readonly matchingService: MatchingService,
  ) {}

  @MessagePattern({ cmd: commands.REQUEST_MATCH })
  async handleRequestMatch(@Payload() data: any) {
    try {

      this.logger.log(
        `Received match request: ${JSON.stringify({ rideRequestId: data.rideRequestId, latitude: data.latitude, longitude: data.longitude })}`,
        'Matching Service - handleRequestMatch',
      );

      const result = await this.matchingService.requestMatch(data as RequestMatchDto);

      this.logger.log(
        `Match request processed: ${result.matchingId}`,
        'Matching Service - handleRequestMatch',
      );

      return {
        data: result,
        message: SuccessMessages.MATCHING_INITIATED,
      };
    } catch (error) {

      this.logger.error(
        `Error in match request: ${error.message || JSON.stringify(error)}`,
        error.stack,
        'Matching Service - handleRequestMatch',
      );

      throw new RpcException({
        statusCode: error.status || error.statusCode || 500,
        message: error.message || ErrorMessages.INTERNAL_MATCHING_ERROR,
      });
    }
  }

  @MessagePattern({ cmd: commands.DRIVER_RESPONSE })
  async handleDriverResponse(@Payload() data: DriverResponseDto) {
    try {

      this.logger.log(
        `Received driver response: ${JSON.stringify(data)}`,
        'Matching Service - handleDriverResponse',
      );

      const result = await this.matchingService.handleDriverResponse(data);

      this.logger.log(
        `Driver response processed: ${data.matchingId}`,
        'Matching Service - handleDriverResponse',
      );

      return {
        data: result,
        message: SuccessMessages.DRIVER_RESPONSE_RECEIVED,
      };
    } catch (error) {

      this.logger.error(
        `Error in driver response: ${error.message || JSON.stringify(error)}`,
        error.stack,
        'Matching Service - handleDriverResponse',
      );

      throw new RpcException({
        statusCode: error.status || error.statusCode || 500,
        message: error.message || ErrorMessages.INTERNAL_MATCHING_ERROR,
      });
    }
  }

  @MessagePattern({ cmd: commands.FINALIZE_MATCH })
  async handleFinalizeMatch(@Payload() data: FinalizeMatchDto) {
    try {

      this.logger.log(
        `Received finalize match request: ${data.matchingId}`,
        'Matching Service - handleFinalizeMatch',
      );

      const result = await this.matchingService.finalizeMatch(data);

      this.logger.log(
        `Match finalized: ${data.matchingId}`,
        'Matching Service - handleFinalizeMatch',
      );

      return {
        data: result,
        message: SuccessMessages.MATCHING_FINALIZED,
      };
    } catch (error) {

      this.logger.error(
        `Error in finalizing match: ${error.message || JSON.stringify(error)}`,
        error.stack,
        'Matching Service - handleFinalizeMatch',
      );

      throw new RpcException({
        statusCode: error.status || error.statusCode || 500,
        message: error.message || ErrorMessages.INTERNAL_MATCHING_FINALIZATION,
      });
    }
  }

  @MessagePattern({ cmd: commands.COUNT_PENDING_MATCHES_BY_AREA })
  async handleCountPendingMatchesByArea(@Payload() data: { areaId?: string }) {
    try {
      const count = await this.matchingService.countPendingMatchesByArea(data?.areaId ?? '');
      return {
        data: { count },
        message: SuccessMessages.MATCHING_INITIATED,
      };
    } catch (error) {
      this.logger.error(
        `Error counting pending matches: ${error.message || JSON.stringify(error)}`,
        error.stack,
        'Matching Service - handleCountPendingMatchesByArea',
      );

      throw new RpcException({
        statusCode: error.status || error.statusCode || 500,
        message: error.message || ErrorMessages.INTERNAL_MATCHING_ERROR,
      });
    }
  }

  @MessagePattern({ cmd: commands.ACCEPT_OFFER })
  async handleAcceptOffer(@Payload() data: AcceptOfferDto) {
    try {
      this.logger.log(`Received accept offer request: ${data.offerId}`, 'Matching Controller');
      const result = await this.matchingService.acceptOffer(data.offerId);
      return {
        data: result,
        message: 'Offer accepted successfully',
      };
    } catch (error) {
      this.logger.error(`Error in handleAcceptOffer: ${error.message}`, error.stack, 'Matching Controller');
      throw new RpcException(error.message);
    }
  }

  @MessagePattern({ cmd: commands.REJECT_OFFER })
  async handleRejectOffer(@Payload() data: RejectOfferDto) {
    try {
      this.logger.log(`Received reject offer request: ${data.offerId}`, 'Matching Controller');
      const result = await this.matchingService.rejectOffer(data.offerId);
      return {
        data: result,
        message: 'Offer rejected successfully',
      };
    } catch (error) {
      this.logger.error(`Error in handleRejectOffer: ${error.message}`, error.stack, 'Matching Controller');
      throw new RpcException(error.message);
    }
  }
}





