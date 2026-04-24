/**
 * Generic aviation / schedule data shapes — usable from UI, APIs, and any
 * data provider (not tied to a single third-party response format).
 */

export type IataCityCode = string
export type IataAirportCode = string
export type IataAirlineCode = string
export type IsoCountryCode = string

export type City = {
  code: IataCityCode
  name: string
  countryCode: IsoCountryCode
  latitude: number
  longitude: number
}

export type Airport = {
  iataCode: IataAirportCode
  icaoCode?: string
  name: string
  cityCode: IataCityCode
  countryCode: IsoCountryCode
  lat: number
  lon: number
}

export type Airline = {
  iataCode: IataAirlineCode
  icaoCode?: string
  name: string
  countryCode: IsoCountryCode
}

/**
 * A single leg schedule instance (timetable or operational).
 * `source` is an arbitrary label for how the row was obtained (e.g. cache, scrape, a vendor id).
 */
export type FlightSchedule = {
  flightNumber: string
  airlineCode: IataAirlineCode
  departure: { airport: IataAirportCode; time: string }
  arrival: { airport: IataAirportCode; time: string }
  /** Block or scheduled flight time in minutes, when known. */
  duration?: number
  aircraft?: string
  source: string
  /** ISO-8601 when this row was produced or read from cache. */
  fetchedAt: string
}
