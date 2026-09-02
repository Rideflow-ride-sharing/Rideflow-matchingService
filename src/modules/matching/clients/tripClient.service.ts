import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ClientProxy, ClientProxyFactory, Transport } from '@nestjs/microservices';
import { LoggerService } from '../../../common/logger/logger.service';
import { Queue, TripCommands } from '../../../common/constants';
import { lastValueFrom } from 'rxjs';
import { retry, catchError, timeout } from 'rxjs/operators';
import { throwError } from 'rxjs';

@Injectable()
export class TripClientService implements OnModuleDestroy {
  private client: ClientProxy;

  constructor(private readonly logger: LoggerService) {
    this.client = ClientProxyFactory.create({
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
        queue: Queue.TRIP_SERVICE,
        queueOptions: {
          durable: false,
          arguments: {
            'x-dead-letter-exchange': process.env.RMQ_DLX_EXCHANGE || 'uber.dlx',
            'x-dead-letter-routing-key': process.env.RMQ_DLX_TRIP_ROUTING_KEY || 'trip_service.dlq',
          },
        },
      },
    });
  }

  async assignTripToDriver(tripId: string, driverId: string) {
    this.logger.log(`Sending assign trip command to Trip Service: ${tripId} -> ${driverId}`, 'Matching Service - assignTripToDriver');

    try {
      const response = await lastValueFrom(
        this.client.send({ cmd: TripCommands.ASSIGN_TRIP_TO_DRIVER }, { tripId, driverId }).pipe(
          timeout(10000),
          retry({ count: 3, delay: 1000 }),
          catchError((error) => {
            this.logger.error(`Failed to assign trip in Trip Service after retries: ${tripId}`, error.stack, 'Matching Service - assignTripToDriver');
            return throwError(() => error);
          }),
        ),
      );

      this.logger.log(`Trip assigned successfully in Trip Service`, 'Matching Service - assignTripToDriver');
      return response?.data;
    } catch (error) {
      this.logger.error(`Error assigning trip in Trip Service: ${error.message}`, error.stack, 'Matching Service - assignTripToDriver');
      throw error;
    }
  }

  async rejectTrip(tripId: string) {
    this.logger.log(`Sending reject trip command to Trip Service: ${tripId}`, 'Matching Service - rejectTrip');

    try {
      const response = await lastValueFrom(
        this.client.send({ cmd: TripCommands.REJECT_TRIP }, { tripId }).pipe(
          timeout(5000),
          retry({ count: 2, delay: 1000 }),
          catchError((error) => {
            this.logger.error(`Failed to reject trip in Trip Service after retries: ${tripId}`, error.stack, 'Matching Service - rejectTrip');
            return throwError(() => error);
          }),
        ),
      );

      this.logger.log(`Trip rejected successfully in Trip Service`, 'Matching Service - rejectTrip');
      return response?.data;
    } catch (error) {
      this.logger.error(`Error rejecting trip in Trip Service: ${error.message}`, error.stack, 'Matching Service - rejectTrip');
      // Do not throw to avoid crashing matching finalizer
    }
  }

  async cancelTrip(tripId: string, reason?: string) {
    this.logger.log(`Sending cancel trip command to Trip Service: ${tripId}`, 'Matching Service - cancelTrip');

    try {
      const response = await lastValueFrom(
        this.client.send({ cmd: TripCommands.CANCEL_TRIP }, { tripId, reason }).pipe(
          timeout(5000),
          retry({ count: 2, delay: 1000 }),
          catchError((error) => {
            this.logger.error(`Failed to cancel trip in Trip Service after retries: ${tripId}`, error.stack, 'Matching Service - cancelTrip');
            return throwError(() => error);
          }),
        ),
      );

      this.logger.log(`Trip cancelled successfully in Trip Service`, 'Matching Service - cancelTrip');
      return response?.data;
    } catch (error) {
      this.logger.error(`Error cancelling trip in Trip Service: ${error.message}`, error.stack, 'Matching Service - cancelTrip');
    }
  }

  async onModuleDestroy() {
    await this.client.close();
  }
}
