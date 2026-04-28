/** Client-side airline catalog (OpenFlights `airlines.dat`–derived). */

export type Airline = {
  /** IATA airline designator, e.g. "SK" */
  iata: string
  name: string
  /** ISO 3166-1 alpha-2, e.g. "SE" */
  country: string
}
