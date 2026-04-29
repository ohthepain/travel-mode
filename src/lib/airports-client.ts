import type { Airport } from './airports-data'
import { getCachedAirports, putCachedAirports } from './airports-idb'

export const airportsByIata = new Map<string, Airport>()
export const airportsList: Airport[] = []

let loadPromise: Promise<void> | null = null

function applyDataset(airports: Airport[]) {
  airportsByIata.clear()
  airportsList.length = 0
  for (const a of airports) {
    airportsByIata.set(a.iata, a)
    airportsList.push(a)
  }
}

export function parseAirportsJson(data: unknown): Airport[] {
  if (!Array.isArray(data)) return []
  const parsed: Airport[] = []
  for (const x of data) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const iata = o.iata
    const name = o.name
    const city = o.city
    const country = o.country
    const displayName = o.displayName
    const airportType =
      typeof o.airportType === 'string' ? o.airportType : ''
    const lat = o.lat
    const lon = o.lon
    if (
      typeof iata !== 'string' ||
      typeof name !== 'string' ||
      typeof city !== 'string' ||
      typeof country !== 'string' ||
      typeof displayName !== 'string' ||
      typeof lat !== 'number' ||
      typeof lon !== 'number'
    ) {
      continue
    }
    parsed.push({
      iata,
      name,
      city,
      country,
      displayName,
      airportType,
      lat,
      lon,
    })
  }
  return parsed
}

/**
 * Load `public/data/airports.json` from IndexedDB (if present) then refresh over the network.
 * Writes back to IDB after a successful fetch. Safe to call from multiple places.
 */
export function ensureAirportsLoaded(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    try {
      const cached = await getCachedAirports()
      if (cached !== null) {
        applyDataset(cached)
      }

      const r = await fetch('/data/airports.json', { cache: 'no-cache' })
      if (!r.ok) {
        if (airportsList.length === 0) applyDataset([])
        return
      }
      const data = (await r.json()) as unknown
      const parsed = parseAirportsJson(data)
      applyDataset(parsed)
      await putCachedAirports(parsed)
    } catch {
      if (airportsList.length === 0) applyDataset([])
    }
  })()
  return loadPromise
}
