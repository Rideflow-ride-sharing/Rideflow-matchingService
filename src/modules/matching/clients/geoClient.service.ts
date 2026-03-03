import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ClientProxy, ClientProxyFactory, Transport } from '@nestjs/microservices';
import { LoggerService } from '../../../common/logger/logger.service';
import { Queue, GeoCommands } from '../../../common/constants';
import { lastValueFrom } from 'rxjs';
import { retry, catchError, timeout } from 'rxjs/operators';
import { throwError } from 'rxjs';

@Injectable()
export class GeoClientService implements OnModuleDestroy {
  private client: ClientProxy;

  constructor(private readonly logger: LoggerService) {
    this.client = ClientProxyFactory.create({
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
        queue: Queue.GEO_SERVICE,
        queueOptions: {
          durable: false,
        },
      },
    });
  }

  async findNearbyDrivers(data: { latitude: number; longitude: number; radiusInMeters: number; limit?: number }) {

    this.logger.log(
      `Finding nearby drivers: ${JSON.stringify(data)}`,
      'Matching Service - findNearbyDrivers',
    );

    try {
      const response = await lastValueFrom(
        this.client.send({ cmd: GeoCommands.FIND_NEARBY_DRIVERS }, data).pipe(
          timeout(10000),
          retry({ count: 3, delay: 1000 }),
          catchError((error) => {
            this.logger.error(
              `Failed to find nearby drivers after retries`,
              error.stack,
              'Matching Service - findNearbyDrivers',
            );
            return throwError(() => error);
          }),
        ),
      );

      this.logger.log(
        `Found ${response?.data?.length || 0} nearby drivers`,
        'Matching Service - findNearbyDrivers',
      );

      return response?.data || [];
    } catch (error) {

      this.logger.error(
        `Error finding nearby drivers: ${error.message || JSON.stringify(error)}`,
        error.stack,
        'Matching Service - findNearbyDrivers',
      );

      throw error;
    }
  }

  async onModuleDestroy() {
    await this.client.close();
  }
}


