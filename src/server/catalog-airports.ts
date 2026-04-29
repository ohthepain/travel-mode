import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CatalogAirport } from '../lib/flight-data'

let memo: CatalogAirport[] | null = null

/** Static bundle from `public/data/airports.json` (server filesystem read). */
export function readBundledCatalogAirports(): CatalogAirport[] {
  if (memo) return memo
  const base = dirname(fileURLToPath(import.meta.url))
  const path = join(base, '../../public/data/airports.json')
  memo = JSON.parse(readFileSync(path, 'utf8')) as CatalogAirport[]
  return memo
}

/** Airports whose metropolitan / travel city code equals `cityCode` (distinct IATAs, sorted). */
export function airportIatasForCityCode(cityCode: string): string[] {
  const cc = cityCode.trim().toUpperCase()
  const catalog = readBundledCatalogAirports()
  const set = new Set<string>()
  for (const a of catalog) {
    if (a.cityCode === cc) set.add(a.iata)
  }
  return [...set].sort((x, y) => x.localeCompare(y))
}
