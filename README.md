# RideFlow — Matching Service

## Overview
The Matching Service is responsible for finding and matching available drivers with riders in the RideFlow ride-hailing platform. It coordinates between the Geo Service and Driver Service to find the best available driver efficiently.

## Role in the System
The Matching Service acts as the **matchmaker** between riders and drivers, ensuring:
- Riders get connected to nearby available drivers
- Drivers are matched with riders efficiently
- Driver availability is verified before matching
- Optimal matching based on proximity and availability

## Key Responsibilities
### Driver-Rider Matching
- **Match Request Processing**: Handles requests to find drivers for riders
- **Nearby Driver Search**: Queries Geo Service for drivers in the area
- **Availability Verification**: Checks driver status before matching
- **Match Finalization**: Completes the matching process and assigns driver to trip

### Matching Logic
- Finds drivers within a specified radius of the rider's location
- Verifies drivers are online and available (not on another trip)
- Supports sequential and parallel offer modes with configurable timeouts (15s)
- Automatic radius expansion when no drivers are found in initial radius

### Service Coordination
- **Geo Service**: Queries for nearby drivers based on location
- **Driver Service**: Verifies driver availability and handles assignment
- **Trip Service**: Coordinates trip assignment after match is finalized

## Service Interactions
- **Receives Commands From**: API Gateway
- **Communicates With**:
  - Geo Service (for finding nearby drivers)
  - Driver Service (for checking driver status and assignment)
- **Publishes Events To**: Other services (via RabbitMQ events)

## Matching Flow
1. Rider requests a match with their location
2. Service queries Geo Service for nearby drivers
3. Service verifies each driver's availability via Driver Service
4. Available drivers are offered the trip (sequential or parallel mode)
5. Match is finalized and driver is assigned to trip

## Use Cases
1. **Rider Requests Match**: Rider needs a ride, service finds nearby available drivers
2. **Driver Availability Check**: Verifies selected driver is still available
3. **Match Finalization**: Confirms match and assigns driver to trip
4. **Driver Response**: Handles driver acceptance/rejection of match requests

## Environment Variables
- `HTTP_PORT`: HTTP server port for health checks (default: 3003)
- `RABBITMQ_URL`: RabbitMQ connection URL
- `MONGODB_URI`: MongoDB connection string

## Health Check
- `GET /health` - Basic health status
- `GET /health/ready` - Readiness check (database connection)
- `GET /health/live` - Liveness check
