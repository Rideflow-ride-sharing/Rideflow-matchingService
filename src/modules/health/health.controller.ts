import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Controller('health')
export class HealthController {
  constructor(
    private readonly configService: ConfigService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  @Get()
  health() {
    return {
      status: 'up',
      timestamp: new Date().toISOString(),
      service: 'matching-service',
      environment: this.configService.get<string>('NODE_ENV') || 'development',
    };
  }

  @Get('ready')
  async readiness() {
    const checks = {
      database: 'unknown',
      timestamp: new Date().toISOString(),
    };

    try {
      // Check MongoDB connection
      const dbState = this.connection.readyState;
      if (dbState === 1) {
        checks.database = 'connected';
      } else {
        checks.database = 'disconnected';
      }
    } catch (error) {
      checks.database = 'error';
    }

    const isReady = checks.database === 'connected';

    return {
      status: isReady ? 'ready' : 'not ready',
      checks,
    };
  }

  @Get('live')
  liveness() {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
    };
  }
}


