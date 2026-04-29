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

/**
 * Static airport rows from OurAirports-derived JSON (`public/data/airports.json`).
 * Distinct from schedule/API {@link Airport}.
 */
export type CatalogAirport = {
  displayName: string
  /**
   * OurAirports CSV `type` (e.g. `large_airport`, `medium_airport`, `seaplane_base`);
   * excluded facility kinds never appear in the bundle.
   */
  airportType: string
  /** IATA location code */
  iata: string
  name: string
  city: string
  country: IsoCountryCode
  lat: number
  lon: number
}

/** Static airline rows from OpenFlights-derived JSON (`public/data/airlines.json`). */
export type CatalogAirline = {
  /** IATA airline designator */
  iata: string
  name: string
  country: IsoCountryCode
}

/**
 * Tie-break weight for OurAirports facility `type`: larger = prefer in dedupe and autocomplete.
 * Matches CSV import dedupe order in `#/lib/airports-csv`.
 */
export function catalogAirportFacilityRank(facilityType: string): number {
  switch (facilityType) {
    case 'large_airport':
      return 4
    case 'medium_airport':
      return 3
    case 'seaplane_base':
      return 2
    default:
      return 1
  }
}

/** Schedule / API airport (vendor-neutral). Distinct from {@link CatalogAirport}. */
export type Airport = {
  iataCode: IataAirportCode
  icaoCode?: string
  name: string
  cityCode: IataCityCode
  countryCode: IsoCountryCode
  lat: number
  lon: number
}

/** Schedule / API airline. Distinct from {@link CatalogAirline}. */
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
