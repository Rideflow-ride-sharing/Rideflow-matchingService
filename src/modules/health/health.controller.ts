import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly configService: ConfigService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health status', description: 'Returns overall health status' })
  @ApiResponse({ status: 200, description: 'Health status retrieved successfully' })
  health() {
    return {
      status: 'up',
      timestamp: new Date().toISOString(),
      service: 'matching-service',
      environment: this.configService.get<string>('NODE_ENV') || 'development',
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness check', description: 'Checks if the service dependencies are ready' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
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
  @ApiOperation({ summary: 'Liveness check', description: 'Checks if the service is alive' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  liveness() {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
    };
  }
}


