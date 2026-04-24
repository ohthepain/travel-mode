/**
 * AirLabs `api/v9` response row shapes (internal to the server client).
 */
export type AirlabsScheduleRow = {
  airline_iata?: string
  airline_icao?: string
  flight_iata?: string
  flight_icao?: string
  flight_number?: string
  dep_iata?: string
  dep_icao?: string
  arr_iata?: string
  arr_icao?: string
  dep_time_utc?: string
  dep_estimated_utc?: string
  dep_actual_utc?: string
  arr_time_utc?: string
  arr_estimated_utc?: string
  arr_actual_utc?: string
  duration?: number
  [k: string]: unknown
}

export type AirlabsRouteRow = {
  airline_iata?: string
  airline_icao?: string
  flight_iata?: string
  flight_icao?: string
  flight_number?: string
  dep_iata?: string
  dep_icao?: string
  arr_iata?: string
  arr_icao?: string
  dep_time_utc?: string
  arr_time_utc?: string
  duration?: number
  days?: string[]
  aircraft_icao?: string
  [k: string]: unknown
}
