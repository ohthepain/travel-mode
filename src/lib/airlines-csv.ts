import type { CatalogAirline } from './flight-data'
import { openFlightsCountryToIso } from './openflights-country-to-iso'
import { parseCsv } from './csv-parse'

export function normalizeOpenFlightsField(raw: string): string {
  const s = raw.trim()
  if (s === '' || s === '\\N') return ''
  return s.replace(/\s+/g, ' ').trim()
}

/** Two-character IATA airline designator (digits allowed, e.g. `1T`). */
export function normalizeAirlineIata(raw: string): string | null {
  const x = normalizeOpenFlightsField(raw).toUpperCase()
  if (x.length !== 2 || !/^[A-Z0-9]{2}$/.test(x)) return null
  return x
}

/** Three-letter ICAO airline designator (used for dedupe tie-breakers only). */
function normalizeAirlineIcao(raw: string): string | null {
  const x = normalizeOpenFlightsField(raw).toUpperCase()
  if (x.length !== 3 || !/^[A-Z]{3}$/.test(x)) return null
  return x
}

function isActiveField(raw: string): boolean {
  return normalizeOpenFlightsField(raw).toUpperCase() === 'Y'
}

function looksLikeHeaderRow(cols: string[]): boolean {
  return cols[0]?.trim().toLowerCase() === 'airlineid'
}

function completeness(isoCountry: string, icao: string): number {
  let s = 0
  if (isoCountry.length === 2) s += 8
  if (icao) s += 2
  return s
}

/**
 * Parse OpenFlights `airlines.dat` (CSV, optional header
 * `AirlineID,Name,Alias,IATA,ICAO,Callsign,Country,Active`).
 * Keeps `Active === Y`, requires valid 2-char IATA, resolves country to ISO when possible.
 * Dedupes by IATA (prefers resolved country + ICAO completeness; ties → lower AirlineID).
 */
export function airlinesFromOpenFlightsDat(text: string): CatalogAirline[] {
  const bomStripped = text.replace(/^\uFEFF/, '')
  const rows = parseCsv(bomStripped.trimEnd())
  if (rows.length === 0) return []

  let start = 0
  if (rows[0] && looksLikeHeaderRow(rows[0])) start = 1

  const best = new Map<
    string,
    { score: number; sourceId: number; row: CatalogAirline }
  >()

  for (let r = start; r < rows.length; r++) {
    const cols = rows[r]
    if (cols.length < 8) continue

    const sourceId = Number.parseInt(cols[0] ?? '', 10)
    if (!Number.isFinite(sourceId)) continue

    if (!isActiveField(cols[7] ?? '')) continue

    const name = normalizeOpenFlightsField(cols[1] ?? '')
    if (!name) continue

    const iata = normalizeAirlineIata(cols[3] ?? '')
    if (!iata) continue

    const icao = normalizeAirlineIcao(cols[4] ?? '') ?? ''
    const countryRaw = normalizeOpenFlightsField(cols[6] ?? '')
    const country = openFlightsCountryToIso(countryRaw)
    if (!country) continue

    const row: CatalogAirline = { iata, name, country }

    const score = completeness(country, icao)
    const prev = best.get(iata)
    if (
      !prev ||
      score > prev.score ||
      (score === prev.score && sourceId < prev.sourceId)
    ) {
      best.set(iata, { score, sourceId, row })
    }
  }

  return [...best.values()]
    .map((x) => x.row)
    .sort((a, b) => a.iata.localeCompare(b.iata) || a.name.localeCompare(b.name))
}

export function airlinesToJsonBlob(airlines: CatalogAirline[]): Blob {
  return new Blob([`${JSON.stringify(airlines, null, 2)}\n`], {
    type: 'application/json',
  })
}
