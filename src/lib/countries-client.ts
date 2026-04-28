import type { Country } from './countries-data'
import { getCachedCountries, putCachedCountries } from './countries-idb'

export const countriesByCode = new Map<string, Country>()
export const countriesList: Country[] = []

let loadPromise: Promise<void> | null = null

function applyDataset(countries: Country[]) {
  countriesByCode.clear()
  countriesList.length = 0
  for (const c of countries) {
    countriesByCode.set(c.code, c)
    countriesList.push(c)
  }
}

export function parseCountriesJson(data: unknown): Country[] {
  if (!Array.isArray(data)) return []
  const parsed: Country[] = []
  for (const x of data) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if (
      typeof o.code !== 'string' ||
      typeof o.iso3 !== 'string' ||
      typeof o.name !== 'string' ||
      typeof o.capital !== 'string' ||
      typeof o.continent !== 'string' ||
      typeof o.currency !== 'string' ||
      typeof o.phone !== 'string' ||
      !Array.isArray(o.languages)
    ) {
      continue
    }
    if (!/^[A-Z]{2}$/.test(o.code)) continue
    if (!/^[A-Z]{3}$/.test(o.iso3)) continue
    const numeric = o.numeric
    if (typeof numeric !== 'number' || !Number.isFinite(numeric)) continue
    const languages: string[] = []
    for (const lang of o.languages) {
      if (typeof lang === 'string' && lang.trim()) languages.push(lang.trim())
    }
    parsed.push({
      code: o.code,
      iso3: o.iso3,
      numeric,
      name: o.name,
      capital: o.capital,
      continent: o.continent,
      currency: o.currency,
      phone: o.phone,
      languages,
    })
  }
  return parsed
}

export function ensureCountriesLoaded(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    try {
      const cached = await getCachedCountries()
      if (cached !== null) {
        applyDataset(cached)
      }

      const r = await fetch('/data/countries.json', { cache: 'no-cache' })
      if (!r.ok) {
        if (countriesList.length === 0) applyDataset([])
        return
      }
      const data = (await r.json()) as unknown
      const parsed = parseCountriesJson(data)
      applyDataset(parsed)
      await putCachedCountries(parsed)
    } catch {
      if (countriesList.length === 0) applyDataset([])
    }
  })()
  return loadPromise
}
