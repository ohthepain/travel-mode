import type { Airline } from './airlines-data'
import { getCachedAirlines, putCachedAirlines } from './airlines-idb'

export const airlinesByIata = new Map<string, Airline>()
export const airlinesList: Airline[] = []

let loadPromise: Promise<void> | null = null

function applyDataset(airlines: Airline[]) {
  airlinesByIata.clear()
  airlinesList.length = 0
  for (const a of airlines) {
    airlinesByIata.set(a.iata, a)
    airlinesList.push(a)
  }
}

export function parseAirlinesJson(data: unknown): Airline[] {
  if (!Array.isArray(data)) return []
  const parsed: Airline[] = []
  for (const x of data) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if (
      typeof o.iata !== 'string' ||
      typeof o.name !== 'string' ||
      typeof o.country !== 'string'
    ) {
      continue
    }
    if (!/^[A-Z0-9]{2}$/.test(o.iata)) continue
    if (!/^[A-Z]{2}$/.test(o.country)) continue
    parsed.push({
      iata: o.iata,
      name: o.name,
      country: o.country,
    })
  }
  return parsed
}

export function ensureAirlinesLoaded(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    try {
      const cached = await getCachedAirlines()
      if (cached !== null) {
        applyDataset(cached)
      }

      const r = await fetch('/data/airlines.json', { cache: 'no-cache' })
      if (!r.ok) {
        if (airlinesList.length === 0) applyDataset([])
        return
      }
      const data = (await r.json()) as unknown
      const parsed = parseAirlinesJson(data)
      applyDataset(parsed)
      await putCachedAirlines(parsed)
    } catch {
      if (airlinesList.length === 0) applyDataset([])
    }
  })()
  return loadPromise
}
