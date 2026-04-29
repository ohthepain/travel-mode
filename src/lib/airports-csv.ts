import type { CatalogAirport } from './flight-data'
import { catalogAirportFacilityRank } from './flight-data'
import { parseCsv } from './csv-parse'

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

/**
 * Parse OurAirports-style `airports.csv` text into normalized `Airport` records.
 * Keeps rows with 3-letter IATA, non-excluded types, valid ISO country, deduped by IATA
 * (prefers larger facility types when duplicates exist).
 */
export function airportsFromOurAirportsCsv(text: string): CatalogAirport[] {
  const bomStripped = text.replace(/^\uFEFF/, '')
  const rows = parseCsv(bomStripped.trimEnd())
  if (rows.length < 2) return []

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

  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r]
    const raw = rowToRaw(cols, idx)
    if (!raw) continue

    const airport: CatalogAirport = {
      displayName: buildAirportDisplayName(raw.name, raw.iata),
      airportType: raw.type,
      iata: raw.iata,
      name: raw.name,
      city: raw.municipality,
      country: raw.isoCountry,
      lat: raw.lat,
      lon: raw.lon,
    }

    const rank = catalogAirportFacilityRank(raw.type)
    const prev = best.get(raw.iata)
    if (!prev || rank > prev.rank) {
      best.set(raw.iata, { rank, airport })
    }
  }

  return [...best.values()]
    .map((x) => x.airport)
    .sort((a, b) => a.iata.localeCompare(b.iata))
}

export function airportsToJsonBlob(airports: CatalogAirport[]): Blob {
  return new Blob([`${JSON.stringify(airports, null, 2)}\n`], {
    type: 'application/json',
  })
}
