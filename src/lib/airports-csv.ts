import type { CatalogAirport, CatalogCity, IsoCountryCode } from './flight-data'
import { catalogAirportFacilityRank } from './flight-data'
import { parseCsv } from './csv-parse'
import { resolveCatalogCityCode } from './catalog-city-resolve'

/** Types dropped from the catalog (OurAirports `type`). */
const EXCLUDED_TYPES = new Set([
  'small_airport',
  'heliport',
  'closed',
  'close',
  'balloonport',
])

/** ISO 3166-1 alpha-2 after trim + uppercase; false if not two letters A–Z. */
export function normalizeIsoCountry(raw: string): string | null {
  const c = raw.trim().toUpperCase()
  if (c.length !== 2 || !/^[A-Z]{2}$/.test(c)) return null
  return c
}

export function normalizeIataCode(raw: string): string | null {
  const x = raw.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(x)) return null
  return x
}

export function buildAirportDisplayName(airportName: string, iata: string): string {
  let s = airportName.trim()
  s = s.replace(/\s+Airport\s*$/i, '').trim()
  s = s.replace(/-/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return `${s} (${iata})`
}

function headerIndex(headerRow: string[], name: string): number {
  const i = headerRow.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase())
  if (i < 0) throw new Error(`CSV missing required column "${name}"`)
  return i
}

type RawRow = {
  type: string
  name: string
  lat: number
  lon: number
  isoCountry: string
  municipality: string
  iata: string
}

function rowToRaw(cols: string[], idx: Record<string, number>): RawRow | null {
  const type = cols[idx.type]?.trim() ?? ''
  if (!type || EXCLUDED_TYPES.has(type)) return null

  const iata = normalizeIataCode(cols[idx.iata] ?? '')
  if (!iata) return null

  const isoCountry = normalizeIsoCountry(cols[idx.isoCountry] ?? '')
  if (!isoCountry) return null

  const lat = Number.parseFloat(cols[idx.lat] ?? '')
  const lon = Number.parseFloat(cols[idx.lon] ?? '')
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  const name = (cols[idx.name] ?? '').trim()
  if (!name) return null

  return {
    type,
    name,
    lat,
    lon,
    isoCountry,
    municipality: (cols[idx.municipality] ?? '').trim(),
    iata,
  }
}

type CityVoteState = {
  country: IsoCountryCode
  /** municipality string → count */
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

function catalogCitiesFromVotes(
  byCode: Map<string, CityVoteState>,
): CatalogCity[] {
  return [...byCode.entries()]
    .map(
      ([code, st]): CatalogCity => ({
        code,
        countryCode: st.country,
        name: pickCityName(st.nameVotes),
      }),
    )
    .sort((a, b) => a.code.localeCompare(b.code))
}

export type AirportCsvImportResult = {
  airports: CatalogAirport[]
  cities: CatalogCity[]
}

/**
 * Parse OurAirports-style `airports.csv` text into normalized catalog rows plus
 * bundled {@link CatalogCity} rows (one per distinct IATA city code after resolution).
 */
export function airportsFromOurAirportsCsv(
  text: string,
  fileOverrides?: Record<string, string>,
): AirportCsvImportResult {
  const bomStripped = text.replace(/^\uFEFF/, '')
  const rows = parseCsv(bomStripped.trimEnd())
  if (rows.length < 2) return { airports: [], cities: [] }

  const header = rows[0].map((c) => c.trim())
  const idx = {
    type: headerIndex(header, 'type'),
    name: headerIndex(header, 'name'),
    lat: headerIndex(header, 'latitude_deg'),
    lon: headerIndex(header, 'longitude_deg'),
    isoCountry: headerIndex(header, 'iso_country'),
    municipality: headerIndex(header, 'municipality'),
    iata: headerIndex(header, 'iata_code'),
  }

  const best = new Map<string, { rank: number; airport: CatalogAirport }>()
  const cityVotes = new Map<string, CityVoteState>()

  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r]
    const raw = rowToRaw(cols, idx)
    if (!raw) continue

    const cityCode = resolveCatalogCityCode(raw.iata, fileOverrides)

    let st = cityVotes.get(cityCode)
    if (!st) {
      st = { country: raw.isoCountry as IsoCountryCode, nameVotes: new Map() }
      cityVotes.set(cityCode, st)
    }
    if (st.country === raw.isoCountry) {
      const mun = raw.municipality.trim() || raw.name.trim()
      if (mun) {
        st.nameVotes.set(mun, (st.nameVotes.get(mun) ?? 0) + 1)
      }
    }

    const airport: CatalogAirport = {
      displayName: buildAirportDisplayName(raw.name, raw.iata),
      airportType: raw.type,
      iata: raw.iata,
      name: raw.name,
      cityCode,
      country: raw.isoCountry as IsoCountryCode,
      lat: raw.lat,
      lon: raw.lon,
    }

    const rank = catalogAirportFacilityRank(raw.type)
    const prev = best.get(raw.iata)
    if (!prev || rank > prev.rank) {
      best.set(raw.iata, { rank, airport })
    }
  }

  const airports = [...best.values()]
    .map((x) => x.airport)
    .sort((a, b) => a.iata.localeCompare(b.iata))

  return {
    airports,
    cities: catalogCitiesFromVotes(cityVotes),
  }
}

export function airportsToJsonBlob(airports: CatalogAirport[]): Blob {
  return new Blob([`${JSON.stringify(airports, null, 2)}\n`], {
    type: 'application/json',
  })
}

export function citiesToJsonBlob(cities: CatalogCity[]): Blob {
  return new Blob([`${JSON.stringify(cities, null, 2)}\n`], {
    type: 'application/json',
  })
}
