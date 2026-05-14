# Rideflow-matchingService


Coordinates driver-rider matching. Queries the Geo Service for nearby drivers, verifies availability via the Driver Service, and offers the trip sequentially or in parallel with configurable 15s timeouts. Automatically expands the search radius if no drivers respond. Once a match is confirmed, creates the trip via the Trip Service.
