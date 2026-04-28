import type { Airport } from './airports-data'

export type AirportSearchDoc = {
  id: string
  search: string
  display: string
}

export function buildAirportSearchDocs(
  airports: Airport[],
): AirportSearchDoc[] {
  return airports.map((airport) => ({
    id: airport.iata,
    search:
      `${airport.iata} ${airport.name} ${airport.city} ${airport.country}`.toLowerCase(),
    display: `${airport.iata} - ${airport.name} (${airport.city})`,
  }))
}

export function filterAirportDocs(
  docs: AirportSearchDoc[],
  query: string,
  limit = 12,
): AirportSearchDoc[] {
  const raw = query.trim().toLowerCase()
  if (!raw) return []
  const tokens = raw.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []

  const matches = docs.filter((d) => tokens.every((t) => d.search.includes(t)))
  const q0 = tokens[0]

  matches.sort((a, b) => {
    const ai = a.id.toLowerCase()
    const bi = b.id.toLowerCase()
    if (tokens.length === 1) {
      if (ai === q0 && bi !== q0) return -1
      if (bi === q0 && ai !== q0) return 1
      if (ai.startsWith(q0) && !bi.startsWith(q0)) return -1
      if (bi.startsWith(q0) && !ai.startsWith(q0)) return 1
    }
    return a.display.localeCompare(b.display)
  })

  return matches.slice(0, limit)
}
