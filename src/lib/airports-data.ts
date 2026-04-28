/** Client-side airport catalog (OurAirports CSV-derived). Distinct from API `Airport` in flight-data. */

export type Airport = {
  displayName: string
  /** IATA location code, e.g. "ARN" */
  iata: string
  name: string
  city: string
  /** ISO 3166-1 alpha-2, GeoNames-style (same as OurAirports `iso_country`) */
  country: string
  lat: number
  lon: number
}
