import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ClientProxy, ClientProxyFactory, Transport } from '@nestjs/microservices';
import { LoggerService } from '../../../common/logger/logger.service';
import { Queue, DriverCommands } from '../../../common/constants';
import { lastValueFrom } from 'rxjs';
import { retry, catchError, timeout } from 'rxjs/operators';
import { throwError } from 'rxjs';

@Injectable()
export class DriverClientService implements OnModuleDestroy {
  private client: ClientProxy;

  constructor(private readonly logger: LoggerService) {
    this.client = ClientProxyFactory.create({
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
        queue: Queue.DRIVER_SERVICE,
        queueOptions: {
          durable: false,
        },
      },
    });
  }

  async getDriverStatus(driverId: string) {

    this.logger.log(`Getting driver status: ${driverId}`, 'Matching Service - getDriverStatus');

    try {
      const response = await lastValueFrom(
        this.client.send({ cmd: DriverCommands.DRIVER_GET_STATUS }, { driverId }).pipe(
          timeout(10000),
          retry({ count: 3, delay: 1000 }),
          catchError((error) => {
            this.logger.error(
              `Failed to get driver status after retries: ${driverId}`,
              error.stack,
              'Matching Service - getDriverStatus',
            );
            return throwError(() => error);
          }),
        ),
      );

      return response?.data;
    } catch (error) {

      this.logger.error(
        `Error getting driver status: ${error.message || JSON.stringify(error)}`,
        error.stack,
        'Matching Service - getDriverStatus',
      );

      throw error;
    }
  }

  async assignTrip(driverId: string, tripId: string) {

    this.logger.log(
      `Assigning trip ${tripId} to driver ${driverId}`,
      'Matching Service - assignTrip',
    );

    try {
      const response = await lastValueFrom(
        this.client.send({ cmd: DriverCommands.DRIVER_ASSIGN_TRIP }, { driverId, tripId }).pipe(
          timeout(10000),
          retry({ count: 3, delay: 1000 }),
          catchError((error) => {
            this.logger.error(
              `Failed to assign trip after retries: ${tripId} to driver ${driverId}`,
              error.stack,
              'Matching Service - assignTrip',
            );
            return throwError(() => error);
          }),
        ),
      );

      this.logger.log(
        `Trip assigned successfully to driver ${driverId}`,
        'Matching Service - assignTrip',
      );

      return response?.data;
    } catch (error) {

      this.logger.error(
        `Error assigning trip: ${error.message || JSON.stringify(error)}`,
        error.stack,
        'Matching Service - assignTrip',
      );

      throw error;
    }
  }

  async onModuleDestroy() {
    await this.client.close();
  }
}


