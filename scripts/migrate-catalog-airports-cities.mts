/**
 * One-off / maintenance: migrate legacy `airports.json` (with `city`) to
 * `cityCode` + write `cities.json`. Also refreshes from current metro map + overrides.
 *
 *   node --import tsx ./scripts/migrate-catalog-airports-cities.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildAirportDisplayName } from '../src/lib/airports-csv.ts'
import type { CatalogAirport, CatalogCity, IsoCountryCode } from '../src/lib/flight-data.ts'
import { resolveCatalogCityCode } from '../src/lib/catalog-city-resolve.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

type LegacyRow = {
  displayName: string
  airportType: string
  iata: string
  name: string
  city?: string
  cityCode?: string
  country: string
  lat: number
  lon: number
}

type CityVoteState = {
  country: IsoCountryCode
  nameVotes: Map<string, number>
}

function pickCityName(votes: Map<string, number>): string {
  let best = ''
  let bestN = -1
  for (const [name, n] of votes) {
    if (!name.trim()) continue
    if (n > bestN || (n === bestN && name.localeCompare(best) < 0)) {
      best = name
      bestN = n
    }
  }
  return best || '—'
}

function main(): void {
  const airportsPath = join(root, 'public/data/airports.json')
  const overridesPath = join(root, 'public/data/air-to-city-code.json')

  const raw = JSON.parse(readFileSync(airportsPath, 'utf8')) as LegacyRow[]
  if (!Array.isArray(raw)) throw new Error('airports.json must be an array')

  let fileOverrides: Record<string, string> = {}
  try {
    const ov = JSON.parse(readFileSync(overridesPath, 'utf8')) as unknown
    fileOverrides =
      ov && typeof ov === 'object' ? (ov as Record<string, string>) : {}
  } catch {
    /* optional */
  }

  const cityVotes = new Map<string, CityVoteState>()
  const next: CatalogAirport[] = []

  for (const row of raw) {
    let cityCode = row.cityCode?.trim().toUpperCase()
    if (!cityCode || !/^[A-Z0-9]{3}$/.test(cityCode)) {
      cityCode = resolveCatalogCityCode(row.iata, fileOverrides)
    }

    const mun = (row.city ?? '').trim()

    let st = cityVotes.get(cityCode)
    if (!st) {
      st = {
        country: row.country as IsoCountryCode,
        nameVotes: new Map(),
      }
      cityVotes.set(cityCode, st)
    }
    if (mun) {
      st.nameVotes.set(mun, (st.nameVotes.get(mun) ?? 0) + 1)
    }

    next.push({
      displayName: row.displayName || buildAirportDisplayName(row.name, row.iata),
      airportType: row.airportType,
      iata: row.iata,
      name: row.name,
      cityCode,
      country: row.country as IsoCountryCode,
      lat: row.lat,
      lon: row.lon,
    })
  }

  next.sort((a, b) => a.iata.localeCompare(b.iata))

  const cities: CatalogCity[] = [...cityVotes.entries()]
    .map(([code, st]) => ({
      code,
      countryCode: st.country,
      name: pickCityName(st.nameVotes),
    }))
    .sort((a, b) => a.code.localeCompare(b.code))

  writeFileSync(airportsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  writeFileSync(
    join(root, 'public/data/cities.json'),
    `${JSON.stringify(cities, null, 2)}\n`,
    'utf8',
  )

  console.log(
    `[migrate] wrote ${next.length} airports, ${cities.length} cities`,
  )
}

main()
