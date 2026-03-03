// Common constants for the Matching Service microservice

export * from './commands';

export const EnvConstants = {
  appName: process.env.APP_NAME,
  environment: process.env.NODE_ENV,
  rabbitMQUrl: process.env.RABBITMQ_URL,
};

export const Service = {
  status: {
    up: 'up',
    down: 'down',
  },
  MATCHING_SERVICE: 'MATCHING_SERVICE',
};

export const Queue = {
  MATCHING_SERVICE: 'matching_service_queue',
  GEO_SERVICE: 'geo_service_queue',
  DRIVER_SERVICE: 'driver_service_queue',
};

export const ErrorMessages = {
  // Matching related errors
  MATCHING_NOT_FOUND: 'Matching not found',
  NO_DRIVERS_AVAILABLE: 'No drivers available nearby',
  MATCHING_ALREADY_FINALIZED: 'Matching already finalized',
  INVALID_MATCHING_STATE: 'Invalid matching state',
  DRIVER_NOT_AVAILABLE: 'Driver is not available',
  INTERNAL_MATCHING_ERROR: 'Internal server error occurred during matching',
  INTERNAL_MATCHING_FINALIZATION: 'Internal server error occurred while finalizing match',
};

export const SuccessMessages = {
  MATCHING_INITIATED: 'Matching process initiated successfully',
  DRIVER_RESPONSE_RECEIVED: 'Driver response received successfully',
  MATCHING_FINALIZED: 'Matching finalized successfully',
};

export const MatchingStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  TIMEOUT: 'TIMEOUT',
  FINALIZED: 'FINALIZED',
} as const;

export type MatchingStatusType = typeof MatchingStatus[keyof typeof MatchingStatus];

// Timeout configuration
export const DRIVER_RESPONSE_TIMEOUT_MS = 15000; // 15 seconds

