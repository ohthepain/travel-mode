import type { CatalogAirport, CatalogCity, IsoCountryCode } from './flight-data'
import { catalogAirportFacilityRank } from './flight-data'
import { applyLargeAirportFlagsToCities } from './catalog-cities-large'

export type LocationKind = 'airport' | 'city'

export type LocationSearchDoc = {
  kind: LocationKind
  /** Airport IATA or IATA travel city code. */
  code: string
  search: string
  display: string
  /** Only for `airport` — used for ranking. */
  airportType?: string
  /**
   * Only for `city` — when true, this city outranks airports at the same relevance tier.
   */
  hasLargeAirport?: boolean
}

function countryLabel(
  cc: IsoCountryCode,
  countriesByCode: ReadonlyMap<string, { name: string }>,
): string {
  return countriesByCode.get(cc)?.name ?? cc
}

export function buildLocationSearchDocs(
  airports: readonly CatalogAirport[],
  cities: readonly CatalogCity[],
  countriesByCode: ReadonlyMap<string, { name: string }>,
): LocationSearchDoc[] {
  const citiesRanked = applyLargeAirportFlagsToCities(airports, cities)

  const cityNameByCode = new Map<string, string>()
  for (const c of citiesRanked) {
    cityNameByCode.set(c.code, c.name)
  }

  const out: LocationSearchDoc[] = []

  for (const c of citiesRanked) {
    const cn = countryLabel(c.countryCode, countriesByCode)
    out.push({
      kind: 'city',
      code: c.code,
      search: `${c.code} ${c.name} ${cn} ${c.countryCode}`.toLowerCase(),
      display: `${c.name}, ${cn} (${c.code})`,
      hasLargeAirport: c.hasLargeAirport,
    })
  }

  for (const a of airports) {
    const place = cityNameByCode.get(a.cityCode) ?? a.cityCode
    out.push({
      kind: 'airport',
      code: a.iata,
      search: `${a.iata} ${a.name} ${place} ${a.country}`.toLowerCase(),
      display: `${a.iata} - ${a.name} (${place})`,
      airportType: a.airportType,
    })
  }

  return out
}

function compareLocationRelevance(
  a: LocationSearchDoc,
  b: LocationSearchDoc,
  tokens: string[],
  q0: string,
): number {
  const ac = a.code.toLowerCase()
  const bc = b.code.toLowerCase()
  if (tokens.length === 1) {
    if (ac === q0 && bc !== q0) return -1
    if (bc === q0 && ac !== q0) return 1
    if (ac.startsWith(q0) && !bc.startsWith(q0)) return -1
    if (bc.startsWith(q0) && !ac.startsWith(q0)) return 1
  }
  if (a.kind === 'city' && b.kind === 'city') {
    if (a.hasLargeAirport && !b.hasLargeAirport) return -1
    if (!a.hasLargeAirport && b.hasLargeAirport) return 1
  }
  if (a.kind !== b.kind) {
    /** Cities over airports only when the metro has a bundled large-airport sibling. */
    if (a.kind === 'city' && b.kind === 'airport') {
      return a.hasLargeAirport ? -1 : 1
    }
    if (a.kind === 'airport' && b.kind === 'city') {
      return b.hasLargeAirport ? 1 : -1
    }
  }
  return a.display.localeCompare(b.display)
}

export function filterLocationDocs(
  docs: LocationSearchDoc[],
  query: string,
  limit = 16,
): LocationSearchDoc[] {
  const raw = query.trim().toLowerCase()
  if (!raw) return []
  const tokens = raw.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []

  const matches = docs.filter((d) => tokens.every((t) => d.search.includes(t)))
  const q0 = tokens[0]

  matches.sort((a, b) => {
    const primary = compareLocationRelevance(a, b, tokens, q0)
    if (primary !== 0) return primary
    if (a.kind === 'airport' && b.kind === 'airport') {
      return (
        catalogAirportFacilityRank(b.airportType ?? '') -
        catalogAirportFacilityRank(a.airportType ?? '')
      )
    }
    return 0
  })

  return matches.slice(0, limit)
}
