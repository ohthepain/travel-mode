import fr24pkg from '@flightradar24/fr24sdk'

const { Client } = fr24pkg as { Client: new (opts: { apiToken?: string; apiVersion?: string }) => Fr24Client }

type Fr24Client = {
  close: () => void
  flightSummary: {
    getLight: (p: Record<string, unknown>) => Promise<unknown>
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

/** Window for `flightSummary.getLight`: from (now − lookback) through now, UTC. */
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

/** Defensive: FR24 may return raw JSON with varying shapes. */
export function parseSummaryFlightIds(raw: unknown): { id: string; label?: string }[] {
  const out: { id: string; label?: string }[] = []
  const r = raw as { data?: unknown[] } | unknown[] | null
  const list: unknown = Array.isArray(r) ? r : r && 'data' in r ? (r as { data: unknown[] }).data : undefined
  if (!list || !Array.isArray(list)) return out
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const id = (o.flight_id ?? o.id ?? o.fr24_id) as string | undefined
    if (typeof id === 'string' && id.length) {
      out.push({ id, label: typeof o.flight === 'string' ? o.flight : undefined })
    }
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
