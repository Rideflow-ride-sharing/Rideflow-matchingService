export const commands = {
  // Matching commands
  REQUEST_MATCH: 'matching.request',
  DRIVER_RESPONSE: 'matching.driver_response',
  FINALIZE_MATCH: 'matching.finalize',
  ACCEPT_OFFER: 'matching.accept_offer',
  REJECT_OFFER: 'matching.reject_offer',
  COUNT_PENDING_MATCHES_BY_AREA: 'count_pending_matches_by_area',
};

// External service commands
export const GeoCommands = {
  FIND_NEARBY_DRIVERS: 'find_nearby_drivers',
};

export const DriverCommands = {
  DRIVER_GET_STATUS: 'driver_get_status',
  DRIVER_ASSIGN_TRIP: 'driver_assign_trip',
};

export const TripCommands = {
  ASSIGN_TRIP_TO_DRIVER: 'assign_trip_to_driver',
  REJECT_TRIP: 'reject_trip',
  CANCEL_TRIP: 'cancel_trip',
};





