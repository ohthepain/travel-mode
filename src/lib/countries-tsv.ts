import type { Country } from './countries-data'

const COL_ISO = 0
const COL_ISO3 = 1
const COL_NUMERIC = 2
const COL_COUNTRY = 4
const COL_CAPITAL = 5
const COL_CONTINENT = 8
const COL_CURRENCY = 10
const COL_PHONE = 12
const COL_LANG = 15

function trimField(s: string): string {
  return s.replace(/\r/g, '').trim()
}

function isHeaderLineAfterHash(payload: string): boolean {
  const cols = payload.split('\t')
  return trimField(cols[0] ?? '') === 'ISO' && trimField(cols[1] ?? '') === 'ISO3'
}

function normalizePhone(raw: string): string {
  const p = trimField(raw)
  if (!p) return ''
  if (p.startsWith('+')) return p
  if (/^\d+$/.test(p)) return `+${p}`
  return p
}

function parseLanguages(raw: string): string[] {
  const s = trimField(raw)
  if (!s) return []
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

function normalizeIso2(raw: string): string | null {
  const c = trimField(raw).toUpperCase()
  if (c.length !== 2 || !/^[A-Z]{2}$/.test(c)) return null
  return c
}

function parseNumeric(raw: string): number | null {
  const n = Number.parseInt(trimField(raw), 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse GeoNames `countryInfo.txt` (or equivalent) with `#` comment lines and tab-separated fields.
 * Skips the table header line (`#ISO\tISO3\t...`).
 */
export function countriesFromCountryNamesTxt(text: string): Country[] {
  const bomStripped = text.replace(/^\uFEFF/, '')
  const lines = bomStripped.split(/\r?\n/)
  const byCode = new Map<string, Country>()

  for (const lineRaw of lines) {
    const line = lineRaw.replace(/\r/g, '')
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('#')) {
      const payload = trimmed.slice(1).trimStart()
      if (isHeaderLineAfterHash(payload)) continue
      continue
    }

    const cols = line.split('\t').map(trimField)
    const code = normalizeIso2(cols[COL_ISO] ?? '')
    if (!code) continue

    const iso3 = (cols[COL_ISO3] ?? '').toUpperCase()
    if (!iso3 || iso3.length !== 3 || !/^[A-Z]{3}$/.test(iso3)) continue

    const numeric = parseNumeric(cols[COL_NUMERIC] ?? '')
    if (numeric === null) continue

    const name = cols[COL_COUNTRY] ?? ''
    if (!name) continue

    const continent = cols[COL_CONTINENT] ?? ''
    const currency = (cols[COL_CURRENCY] ?? '').toUpperCase()
    const phone = normalizePhone(cols[COL_PHONE] ?? '')
    const languages = parseLanguages(cols[COL_LANG] ?? '')

    const row: Country = {
      code,
      iso3,
      numeric,
      name,
      capital: cols[COL_CAPITAL] ?? '',
      continent,
      currency,
      phone,
      languages,
    }

    byCode.set(code, row)
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))
}

export function countriesToJsonBlob(countries: Country[]): Blob {
  return new Blob([`${JSON.stringify(countries, null, 2)}\n`], {
    type: 'application/json',
  })
}
