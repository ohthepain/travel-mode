import type { City } from './cities-data'
import { ensureAirToCityOverridesLoaded } from './catalog-air-to-city-overrides'
import { getCachedCities, putCachedCities } from './cities-idb'

export const citiesByCode = new Map<string, City>()
export const citiesList: City[] = []

let loadPromise: Promise<void> | null = null

function applyDataset(cities: City[]) {
  citiesByCode.clear()
  citiesList.length = 0
  for (const c of cities) {
    citiesByCode.set(c.code, c)
    citiesList.push(c)
  }
}

export function parseCitiesJson(data: unknown): City[] {
  if (!Array.isArray(data)) return []
  const parsed: City[] = []
  for (const x of data) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const code = o.code
    const name = o.name
    const countryCode = o.countryCode
    if (
      typeof code !== 'string' ||
      typeof name !== 'string' ||
      typeof countryCode !== 'string'
    ) {
      continue
    }
    if (!/^[A-Z0-9]{3}$/.test(code.trim().toUpperCase())) continue
    if (!/^[A-Z]{2}$/.test(countryCode.trim().toUpperCase())) continue
    parsed.push({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      countryCode: countryCode.trim().toUpperCase(),
    })
  }
  return parsed
}

/**
 * Load `public/data/cities.json` from IndexedDB (if present) then refresh over the network.
 */
export function ensureCitiesLoaded(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    try {
      await ensureAirToCityOverridesLoaded()

      const cached = await getCachedCities()
      if (cached !== null) {
        applyDataset(cached)
      }

      const r = await fetch('/data/cities.json', { cache: 'no-cache' })
      if (!r.ok) {
        if (citiesList.length === 0) applyDataset([])
        return
      }
      const data = (await r.json()) as unknown
      const parsed = parseCitiesJson(data)
      applyDataset(parsed)
      await putCachedCities(parsed)
    } catch {
      if (citiesList.length === 0) applyDataset([])
    }
  })()
  return loadPromise
}
