import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { LoggerService } from './common/logger/logger.service';
import { EnvConstants, Queue } from './common/constants';

async function bootstrap() {
  // Create hybrid application (HTTP + Microservice)
  const app = await NestFactory.create(AppModule);

  // Connect microservice
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [EnvConstants.rabbitMQUrl || 'amqp://localhost:5672'],
      queue: Queue.MATCHING_SERVICE,
      queueOptions: {
        durable: false,
      },
    },
  });

  // Get logger and configuration service
  const logger = app.get(LoggerService);
  const configService = app.get(ConfigService);
  app.useLogger(logger);

  // Apply validation pipe globally
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Start microservice
  await app.startAllMicroservices();

  // Start HTTP server for health checks
  const config = new DocumentBuilder()
    .setTitle('RideFlow Matching Service')
    .setDescription('RideFlow Matching Service API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, { swaggerOptions: { persistAuthorization: true } });

  const port = process.env.HTTP_PORT || 3003;
  await app.listen(port);

  logger.log(`Matching Service Application running`, 'Matching Service - bootstrap');
  logger.log(`Matching Service HTTP server listening on port ${port}`, 'Matching Service - bootstrap');
  logger.log(
    `Matching Service Environment: ${configService.get<string>('NODE_ENV') || 'development'}`,
    'Matching Service - bootstrap',
  );
}
bootstrap();




