import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MatchingModule } from './modules/matching/matching.module';
import { LoggerService } from './common/logger/logger.service';
import { DatabaseModule } from './core/database/database.module';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
    }),
    DatabaseModule,
    MatchingModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService, LoggerService],
})
export class AppModule {}




