import fr24pkg from '@flightradar24/fr24sdk'

const { Client } = fr24pkg as { Client: new (opts: { apiToken?: string; apiVersion?: string }) => Fr24Client }

type Fr24Client = {
  close: () => void
  flightSummary: {
    getLight: (p: Record<string, unknown>) => Promise<unknown>
    getFull: (p: Record<string, unknown>) => Promise<unknown>
  }
  flightTracks: {
    get: (flightId: string) => Promise<unknown>
  }
}

export function getFr24Client(): Fr24Client | null {
  const token =
    process.env.FLIGHTRADAR24_API_TOKEN?.trim() ||
    process.env.FR24_API_TOKEN?.trim()
  if (!token) return null
  return new Client({ apiToken: token, apiVersion: 'v1' })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Minimum gap between FR24 HTTP calls (per process). Default 1100 ms. */
export function getFr24RequestMinIntervalMs(): number {
  const n = Number(process.env.FR24_REQUEST_MIN_INTERVAL_MS)
  if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  return 1100
}

function getFr24RateLimitInitialBackoffMs(): number {
  const n = Number(process.env.FR24_RATE_LIMIT_INITIAL_BACKOFF_MS)
  if (Number.isFinite(n) && n >= 500) return Math.floor(n)
  return 4000
}

function getFr24RateLimitMaxBackoffMs(): number {
  const n = Number(process.env.FR24_RATE_LIMIT_MAX_BACKOFF_MS)
  if (Number.isFinite(n) && n >= 2000) return Math.floor(n)
  return 120_000
}

function getFr24RateLimitMaxRetries(): number {
  const n = Number(process.env.FR24_RATE_LIMIT_MAX_RETRIES)
  if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  return 8
}

let fr24LastRequestEndedAt = 0
let fr24MutexChain: Promise<void> = Promise.resolve()

export function isFr24RateLimitError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const parts: string[] = []
  if (e instanceof Error) {
    parts.push(e.message)
    const cause = (e as Error & { cause?: unknown }).cause
    if (cause && typeof cause === 'object') {
      try {
        parts.push(JSON.stringify(cause))
      } catch {
        parts.push(String(cause))
      }
    }
  }
  try {
    parts.push(JSON.stringify(e))
  } catch {
    parts.push(String(e))
  }
  const blob = parts.join(' ').toLowerCase()
  if (blob.includes('rate limit') || blob.includes('too many requests')) return true
  const o = e as Record<string, unknown>
  if (o.status === 429 || o.code === 429 || o.code === '429') return true
  const resp = o.response as {
    status?: number
    data?: { message?: string; details?: string }
  } | undefined
  if (resp?.status === 429) return true
  const rd = resp?.data
  if (rd?.message && /rate limit|too many requests/i.test(rd.message)) return true
  if (rd?.details && /too many requests|rate limit/i.test(rd.details)) return true
  const data = o.data as { message?: string; details?: string } | undefined
  if (data?.message && /rate limit|too many requests/i.test(data.message)) return true
  if (data?.details && /too many requests|rate limit/i.test(data.details)) return true
  return false
}

/**
 * Serialize FR24 calls in this process, enforce a minimum interval, and retry on rate limits.
 * Use for every SDK HTTP call to avoid burst limits when syncing tracks.
 */
export async function fr24Request<T>(fn: () => Promise<T>): Promise<T> {
  const job = async (): Promise<T> => {
    const minGap = getFr24RequestMinIntervalMs()
    const maxRetries = getFr24RateLimitMaxRetries()
    let backoff = getFr24RateLimitInitialBackoffMs()
    const backoffMax = getFr24RateLimitMaxBackoffMs()

    for (let attempt = 0; ; attempt++) {
      const now = Date.now()
      const waitGap = fr24LastRequestEndedAt + minGap - now
      if (waitGap > 0) await sleep(waitGap)

      try {
        const out = await fn()
        fr24LastRequestEndedAt = Date.now()
        return out
      } catch (err) {
        fr24LastRequestEndedAt = Date.now()
        if (!isFr24RateLimitError(err) || attempt >= maxRetries) throw err
        await sleep(backoff)
        backoff = Math.min(Math.floor(backoff * 1.8), backoffMax)
      }
    }
  }

  const next = fr24MutexChain.then(job)
  fr24MutexChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

const PAD2 = (n: number) => String(n).padStart(2, '0')

/** FR24 validation expects `YYYY-MM-DDTHH:MM:SS` (no ms, no `Z`). */
export function formatFr24UtcDateTime(d: Date): string {
  return `${d.getUTCFullYear()}-${PAD2(d.getUTCMonth() + 1)}-${PAD2(d.getUTCDate())}T${PAD2(d.getUTCHours())}:${PAD2(d.getUTCMinutes())}:${PAD2(d.getUTCSeconds())}`
}

/**
 * How far back to search flight summaries (UTC calendar span).
 * Override with `FR24_FLIGHT_SUMMARY_LOOKBACK_DAYS` (1–365), default 14.
 */
export function getFlightSummaryLookbackDays(): number {
  const n = Number(process.env.FR24_FLIGHT_SUMMARY_LOOKBACK_DAYS)
  if (Number.isFinite(n) && n >= 1 && n <= 365) return Math.floor(n)
  return 14
}

/** Window for `flightSummary.getFull` / `getLight`: from (now − lookback) through now, UTC. */
export function flightSummarySearchWindowUtc(now = new Date()) {
  const days = getFlightSummaryLookbackDays()
  const from = new Date(now.getTime() - days * 86_400_000)
  return {
    flight_datetime_from: formatFr24UtcDateTime(from),
    flight_datetime_to: formatFr24UtcDateTime(now),
  }
}

/** UTC midnight for the calendar day of an instant (for `Track.travelDate`). */
export function utcCalendarDateOnly(ms: number): Date {
  const d = new Date(ms)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function summaryDataList(raw: unknown): unknown[] {
  const r = raw as { data?: unknown[] } | unknown[] | null
  const list: unknown = Array.isArray(r) ? r : r && 'data' in r ? (r as { data: unknown[] }).data : undefined
  if (!list || !Array.isArray(list)) return []
  return list
}

/** Defensive: FR24 may return raw JSON with varying shapes. */
export function parseSummaryFlightIds(raw: unknown): { id: string; label?: string }[] {
  return parseSummaryRows(raw).map(({ fr24FlightId, flightNumber }) => ({
    id: fr24FlightId,
    label: flightNumber,
  }))
}

/** Parse FR24 flight-summary datetime (ISO string, with or without `Z`). */
export function parseFr24DateTime(value: unknown): Date | null {
  if (value == null) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value !== 'string' || !value.length) return null
  const d = new Date(value.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(value) ? value : value + 'Z')
  return Number.isNaN(d.getTime()) ? null : d
}

const TOP_LEVEL_SCHEDULE_KEYS = new Set([
  'flight_id',
  'id',
  'fr24_id',
  'flight',
  'orig_iata',
  'dest_iata',
  'dest_iata_actual',
  'origin_icao',
  'destination_icao',
  'orig_icao',
  'dest_icao',
  'datetime_takeoff',
  'datetime_landed',
  'datetime_scheduled_depart',
  'datetime_scheduled_arrival',
  'time_scheduled_depart',
  'time_scheduled_arrival',
  'scheduled_departure',
  'scheduled_arrival',
  'flight_time',
  'first_seen',
  'last_seen',
])

export type ParsedFr24Schedule = {
  originIata: string | null
  destIata: string | null
  originIcao: string | null
  destIcao: string | null
  takeoffAt: Date | null
  landedAt: Date | null
  scheduledDeparture: Date | null
  scheduledArrival: Date | null
  flightTimeSec: number | null
  scheduleJson: Record<string, unknown> | null
}

/**
 * Map one flight-summary **full** (or light) row into storable schedule columns.
 * Field names follow FR24 docs with a few fallbacks.
 */
export function parseSummaryScheduleRow(
  o: Record<string, unknown>,
): ParsedFr24Schedule {
  const originIata = (o.orig_iata ?? o.origin_iata) as string | null | undefined
  const destIata = (o.dest_iata ?? o.destination_iata) as string | null | undefined
  const destIataFinal = (o.dest_iata_actual as string | undefined) ?? destIata
  const originIcao = (o.origin_icao ?? o.orig_icao) as string | null | undefined
  const destIcao = (o.destination_icao ?? o.dest_icao) as string | null | undefined
  const takeoffAt = parseFr24DateTime(
    o.datetime_takeoff ?? o.time_takeoff ?? o.departure,
  )
  const landedAt = parseFr24DateTime(
    o.datetime_landed ?? o.time_landed ?? o.arrival,
  )
  const scheduledDeparture = parseFr24DateTime(
    o.datetime_scheduled_depart ??
      o.time_scheduled_depart ??
      o.scheduled_departure,
  )
  const scheduledArrival = parseFr24DateTime(
    o.datetime_scheduled_arrival ??
      o.time_scheduled_arrival ??
      o.scheduled_arrival,
  )
  const ft = o.flight_time
  let flightTimeSec: number | null = null
  if (typeof ft === 'number' && Number.isFinite(ft)) {
    flightTimeSec = Math.floor(ft)
  } else if (typeof ft === 'string' && /^\d+$/.test(ft)) {
    flightTimeSec = Math.floor(Number(ft))
  }
  const scheduleJson: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (TOP_LEVEL_SCHEDULE_KEYS.has(k)) continue
    if (v === undefined) continue
    scheduleJson[k] = v
  }
  return {
    originIata: typeof originIata === 'string' ? originIata : null,
    destIata: typeof destIataFinal === 'string' ? destIataFinal : null,
    originIcao: typeof originIcao === 'string' ? originIcao : null,
    destIcao: typeof destIcao === 'string' ? destIcao : null,
    takeoffAt,
    landedAt,
    scheduledDeparture,
    scheduledArrival,
    flightTimeSec,
    scheduleJson: Object.keys(scheduleJson).length ? scheduleJson : null,
  }
}

export type Fr24SummaryRow = {
  fr24FlightId: string
  flightNumber: string
  rawRow: Record<string, unknown>
  schedule: ParsedFr24Schedule
}

/** Aligned with @flightradar24/fr24sdk `IATA_FLIGHT_NUMBER_REGEXP` (IATA/number must pass API validation). */
const FR24_IATA_FLIGHT_RE = /^([A-Z]\d|\d[A-Z]|[A-Z]{2})(\d+)$/i

export function normalizeIataFlightLabel(flight: string): string {
  return flight.replace(/\s+/g, '').toUpperCase()
}

/**
 * IATA designators the user might type (e.g. D8+4322) vs. how FR24 lists the same leg (often DY+4322).
 * NSZ+4322 is not valid in the `flights` param (ICAO+number); we expand to D8/DY+number only.
 */
export function expandFlightNumberCandidates(flight: string): string[] {
  const s = normalizeIataFlightLabel(flight)
  const out = new Set<string>()

  const addIfIata = (v: string) => {
    const u = normalizeIataFlightLabel(v)
    if (FR24_IATA_FLIGHT_RE.test(u)) out.add(u)
  }
  addIfIata(s)
  const nsz = /^NSZ(\d+)$/i.exec(s)
  if (nsz) {
    addIfIata(`D8${nsz[1]}`)
    addIfIata(`DY${nsz[1]}`)
  }
  const d8dy = /^(D8|DY)(\d+)$/i.exec(s)
  if (d8dy) {
    addIfIata(d8dy[1].toUpperCase() === 'D8' ? `DY${d8dy[2]}` : `D8${d8dy[2]}`)
  }

  if (out.size > 0) return [...out]
  return [s]
}

/** Aligned with FR24 callsign list validation (3–8 chars, letter/digit/`-`). */
const FR24_CALLSIGN_RE = /^(?:[A-Z0-9-]{3,8}|\*[A-Z0-9-]{3,7}|[A-Z0-9-]{3,7}\*)$/i

/**
 * Fr24 flight summary uses `flights` (IATA) and `callsigns` (transponder) as separate
 * indices; Norwegian Air Sweden often uses NSZ+nn on the wire while tickets show D8/DY+nn.
 */
export function expandFr24CallsignCandidates(flight: string): string[] {
  const s = normalizeIataFlightLabel(flight)
  const out = new Set<string>()
  const add = (v: string) => {
    const u = v.toUpperCase()
    if (FR24_CALLSIGN_RE.test(u)) out.add(u)
  }
  if (/^([A-Z]{3})(\d+)$/.test(s)) add(s)
  const m = FR24_IATA_FLIGHT_RE.exec(s)
  if (m?.[2]) add(`NSZ${m[2]}`)
  return [...out]
}

/**
 * Widen `first_seen` query window: FR24 uses `first_seen` for the range, not always the
 * scheduled local day; ±1 calendar day UTC catches edge first-seen spilling across UTC days.
 */
export function fr24SummaryWindowAroundTravelDate(ymd: string): {
  from: string
  to: string
} {
  const day = new Date(`${ymd.trim().slice(0, 10)}T00:00:00.000Z`)
  const from = new Date(day.getTime() - 86_400_000)
  const to = new Date(day.getTime() + 2 * 86_400_000 - 1000)
  return { from: formatFr24UtcDateTime(from), to: formatFr24UtcDateTime(to) }
}

const utcYmd = (d: Date) =>
  `${d.getUTCFullYear()}-${PAD2(d.getUTCMonth() + 1)}-${PAD2(d.getUTCDate())}`

/**
 * After querying a ~3-day `first_seen` window, keep rows whose schedule or `first_seen`
 * falls on the user-picked **UTC** calendar day (`YYYY-MM-DD`).
 */
export function summaryRowMatchesTravelDate(
  r: Fr24SummaryRow,
  travelYmd: string,
): boolean {
  const y = travelYmd.trim().slice(0, 10)
  if (r.schedule.scheduledDeparture && utcYmd(r.schedule.scheduledDeparture) === y)
    return true
  if (r.schedule.scheduledArrival && utcYmd(r.schedule.scheduledArrival) === y)
    return true
  const o = r.rawRow
  const firstSeen = parseFr24DateTime(o.first_seen)
  if (firstSeen && utcYmd(firstSeen) === y) return true
  const lastSeen = parseFr24DateTime(o.last_seen)
  if (lastSeen && utcYmd(lastSeen) === y) return true
  const dep = parseFr24DateTime(
    o.datetime_scheduled_depart ?? o.time_scheduled_depart,
  )
  if (dep && utcYmd(dep) === y) return true
  const arr = parseFr24DateTime(
    o.datetime_scheduled_arrival ?? o.time_scheduled_arrival,
  )
  if (arr && utcYmd(arr) === y) return true
  return false
}

/** No parsed times on the leg — common for *upcoming* rows before FR24 fills the schedule. */
export function fr24RowHasNoDateSignals(r: Fr24SummaryRow): boolean {
  if (r.schedule.scheduledDeparture) return false
  if (r.schedule.scheduledArrival) return false
  if (r.schedule.takeoffAt) return false
  if (r.schedule.landedAt) return false
  const o = r.rawRow
  if (parseFr24DateTime(o.first_seen)) return false
  if (parseFr24DateTime(o.last_seen)) return false
  if (
    parseFr24DateTime(o.datetime_scheduled_depart ?? o.time_scheduled_depart)
  )
    return false
  if (
    parseFr24DateTime(o.datetime_scheduled_arrival ?? o.time_scheduled_arrival)
  )
    return false
  if (parseFr24DateTime(o.datetime_takeoff ?? o.time_takeoff)) return false
  if (parseFr24DateTime(o.datetime_landed ?? o.time_landed)) return false
  return true
}

export function dedupeFr24SummaryRows(
  rows: Fr24SummaryRow[],
): Fr24SummaryRow[] {
  const m = new Map<string, Fr24SummaryRow>()
  for (const r of rows) {
    if (!m.has(r.fr24FlightId)) m.set(r.fr24FlightId, r)
  }
  return [...m.values()]
}

/** One row per leg from getFull / getLight, with parsed schedule and IATA flight number. */
export function parseSummaryRows(raw: unknown): Fr24SummaryRow[] {
  const out: Fr24SummaryRow[] = []
  for (const row of summaryDataList(raw)) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const id = (o.flight_id ?? o.id ?? o.fr24_id) as string | undefined
    if (typeof id !== 'string' || !id.length) continue
    const f =
      (typeof o.flight === 'string' && o.flight) ||
      (typeof o.operated_as === 'string' && o.operated_as) ||
      (typeof o.callsign === 'string' && o.callsign) ||
      ''
    const flightNumber = f.toUpperCase().trim() || 'UNKNOWN'
    out.push({
      fr24FlightId: id,
      flightNumber,
      rawRow: o,
      schedule: parseSummaryScheduleRow(o),
    })
  }
  return out
}

type TrackPoint = Record<string, unknown>

export function pointCoord(pt: TrackPoint): { lat: number; lon: number; ts: number } | null {
  const lat = (pt.latitude ?? pt.lat) as number | undefined
  const lon = (pt.longitude ?? pt.lon ?? pt.lng) as number | undefined
  const tRaw = (pt.timestamp ?? pt.ts ?? pt.time) as number | string | undefined
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  let ts = 0
  if (typeof tRaw === 'number') {
    ts = tRaw < 1e12 ? tRaw * 1000 : tRaw
  } else if (typeof tRaw === 'string') {
    const d = new Date(tRaw)
    if (!Number.isNaN(d.getTime())) ts = d.getTime()
  }
  return { lat, lon, ts }
}

function extractTracksList(raw: unknown): unknown[] | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as { data?: unknown[]; tracks?: unknown }
  if (Array.isArray(o.data) && o.data[0] != null) {
    const first = o.data[0] as { tracks?: unknown }
    const tr = first.tracks
    return Array.isArray(tr) ? tr : null
  }
  if ('tracks' in o) {
    const tr = o.tracks
    return Array.isArray(tr) ? tr : null
  }
  return null
}

export function trackResponseToLine(raw: unknown): { coords: [number, number][]; times: number[] } {
  const coords: [number, number][] = []
  const times: number[] = []
  const tlist = extractTracksList(raw)
  if (!tlist) return { coords, times }
  for (const p of tlist) {
    if (!p || typeof p !== 'object') continue
    const c = pointCoord(p as TrackPoint)
    if (!c) continue
    coords.push([c.lon, c.lat])
    times.push(c.ts)
  }
  return { coords, times: times }
}
