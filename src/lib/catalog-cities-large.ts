import type { CatalogAirport, CatalogCity } from './flight-data'

/**
 * Sets `hasLargeAirport` from the bundled airport list: true when any airport
 * with the same `cityCode` has `airportType === 'large_airport'`.
 * Call this whenever airports + cities are assembled (CSV import, JSON merge, or UI).
 */
export function applyLargeAirportFlagsToCities(
  airports: readonly CatalogAirport[],
  cities: readonly CatalogCity[],
): CatalogCity[] {
  const metroWithLarge = new Set<string>()
  for (const a of airports) {
    if (a.airportType === 'large_airport') {
      metroWithLarge.add(a.cityCode.trim().toUpperCase())
    }
  }
  return cities.map((c) => ({
    ...c,
    hasLargeAirport: metroWithLarge.has(c.code.trim().toUpperCase()),
  }))
}
