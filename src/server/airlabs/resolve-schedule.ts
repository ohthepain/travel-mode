import { parseFlightIata } from '../../lib/flight-iata'
import type { FlightSchedule } from '../../lib/flight-data'
import type { Prisma } from '../../../generated/prisma/client'
import { prisma } from '../db'
import {
  fetchRoutesByAirlineAndFlight,
  fetchSchedulesByFlightIata,
} from './client'
import type { AirlabsRouteRow, AirlabsScheduleRow } from './api-types'

const DAY: readonly string[] = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
] as const

type CachePayloadDated = { v: 1; t: 'dated'; items: FlightSchedule[] }
type CachePayloadNodate = { v: 1; t: 'nodate'; routes: AirlabsRouteRow[] }
type CachePayload = CachePayloadDated | CachePayloadNodate

export function refTtlMs(): number {
  const n = Number(process.env.AIRLABS_REF_CACHE_TTL_SEC)
  if (Number.isFinite(n) && n > 0) return Math.floor(n) * 1000
  return 30 * 24 * 3600 * 1000
}

export function scheduleTtlMs(): number {
  const n = Number(process.env.AIRLABS_SCHEDULE_CACHE_TTL_SEC)
  if (Number.isFinite(n) && n > 0) return Math.floor(n) * 1000
  return 45 * 60 * 1000
}

/** Parse full UTC time fields from the Schedules API (or ISO). */
function parseScheduleUtc(
  s: string | null | undefined,
): { dateStr: string; d: Date } | null {
  if (!s?.trim()) return null
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
    const d = new Date(t)
    if (Number.isNaN(d.getTime())) return null
    return { dateStr: d.toISOString().slice(0, 10), d }
  }
  if (t.includes(' ')) {
    const d = new Date(
      t.replace(' ', 'T') + (t.length === 16 ? ':00' : '') + 'Z',
    )
    if (Number.isNaN(d.getTime())) return null
    return { dateStr: d.toISOString().slice(0, 10), d }
  }
  return null
}

function parseHmOnDateUtc(ymd: string, hm: string | null | undefined): Date | null {
  if (!hm?.trim()) return null
  const t = hm.trim()
  if (t.includes(' ') || t.includes('T')) {
    return parseScheduleUtc(t)?.d ?? null
  }
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const [_, hh, mm] = m
  const p = ymd.split('-')
  if (p.length !== 3) return null
  const Y = Number(p[0])
  const M = Number(p[1])
  const D = Number(p[2])
  if (![Y, M, D].every((n) => Number.isInteger(n) && n > 0)) return null
  return new Date(Date.UTC(Y, M - 1, D, Number(hh), Number(mm), 0, 0))
}

function minutesOfDay(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

function scheduleRowToFS(
  r: AirlabsScheduleRow,
  fetchedAt: string,
  source: FlightSchedule['source'],
  flightIata: string,
): FlightSchedule | null {
  const parsed = parseFlightIata(flightIata)
  const airline = String(
    (typeof r.airline_iata === 'string' ? r.airline_iata : '') ||
      (parsed.ok ? parsed.airlineIata : ''),
  )
  const fn =
    (typeof r.flight_iata === 'string' ? r.flight_iata : flightIata).replace(
      /\s+/g,
      '',
    ) || flightIata
  if (!r.dep_iata || !r.arr_iata) return null

  const depS =
    (typeof r.dep_actual_utc === 'string' && r.dep_actual_utc) ||
    (typeof r.dep_estimated_utc === 'string' && r.dep_estimated_utc) ||
    (typeof r.dep_time_utc === 'string' && r.dep_time_utc) ||
    ''
  const arrS =
    (typeof r.arr_actual_utc === 'string' && r.arr_actual_utc) ||
    (typeof r.arr_estimated_utc === 'string' && r.arr_estimated_utc) ||
    (typeof r.arr_time_utc === 'string' && r.arr_time_utc) ||
    ''
  if (!depS || !arrS) return null

  const depX = parseScheduleUtc(depS)
  if (!depX) return null
  const depD = depX.d

  let arrD: Date
  const arrX = parseScheduleUtc(arrS)
  if (arrX) {
    arrD = arrX.d
  } else {
    const ymd0 = depD.toISOString().slice(0, 10)
    const t = parseHmOnDateUtc(ymd0, arrS)
    if (!t) return null
    let ad = t
    if (minutesOfDay(ad) < minutesOfDay(depD)) {
      ad = new Date(ad.getTime() + 24 * 3600 * 1000)
    }
    arrD = ad
  }

  return {
    flightNumber: fn,
    airlineCode: airline,
    departure: { airport: String(r.dep_iata), time: depD.toISOString() },
    arrival: { airport: String(r.arr_iata), time: arrD.toISOString() },
    duration: typeof r.duration === 'number' ? r.duration : undefined,
    aircraft: undefined,
    source,
    fetchedAt,
  }
}

function routeToFlightOnDate(
  r: AirlabsRouteRow,
  ymd: string,
  fetchedAt: string,
  source: FlightSchedule['source'],
  flightIata: string,
): FlightSchedule | null {
  const days = (r.days) ?? []
  const wk = DAY[new Date(ymd + 'T12:00:00.000Z').getUTCDay()] ?? '???'
  if (days.length > 0 && !days.map((d) => d.toLowerCase()).includes(wk)) {
    return null
  }
  if (!r.dep_iata || !r.arr_iata) return null
  const depU =
    typeof r.dep_time_utc === 'string' && r.dep_time_utc ? r.dep_time_utc : ''
  const arrU =
    typeof r.arr_time_utc === 'string' && r.arr_time_utc ? r.arr_time_utc : ''
  if (!depU || !arrU) return null

  const yParts = ymd.split('-')
  if (yParts.length !== 3) return null
  const yY = Number(yParts[0])
  const yM = Number(yParts[1])
  const yD = Number(yParts[2])
  if (![yY, yM, yD].every((n) => Number.isInteger(n) && n > 0)) return null

  let depD: Date
  const depParsed = parseScheduleUtc(depU)
  if (depParsed) {
    depD = new Date(
      Date.UTC(
        yY,
        yM - 1,
        yD,
        depParsed.d.getUTCHours(),
        depParsed.d.getUTCMinutes(),
        0,
        0,
      ),
    )
  } else {
    const t = parseHmOnDateUtc(ymd, depU)
    if (!t) return null
    depD = t
  }

  let arrD: Date
  const arrParsed = parseScheduleUtc(arrU)
  if (arrParsed) {
    arrD = new Date(
      Date.UTC(
        yY,
        yM - 1,
        yD,
        arrParsed.d.getUTCHours(),
        arrParsed.d.getUTCMinutes(),
        0,
        0,
      ),
    )
    if (arrD < depD) {
      arrD = new Date(arrD.getTime() + 24 * 3600 * 1000)
    }
  } else {
    const t = parseHmOnDateUtc(ymd, arrU)
    if (!t) return null
    arrD = t
    if (minutesOfDay(arrD) < minutesOfDay(depD)) {
      arrD = new Date(arrD.getTime() + 24 * 3600 * 1000)
    }
  }

  const fn =
    (typeof r.flight_iata === 'string' ? r.flight_iata : flightIata).replace(
      /\s+/g,
      '',
    ) || flightIata
  const p = parseFlightIata(flightIata)
  const airline = String(
    (typeof r.airline_iata === 'string' ? r.airline_iata : '') ||
      (p.ok ? p.airlineIata : ''),
  )

  return {
    flightNumber: fn,
    airlineCode: airline,
    departure: { airport: String(r.dep_iata), time: depD.toISOString() },
    arrival: { airport: String(r.arr_iata), time: arrD.toISOString() },
    duration: typeof r.duration === 'number' ? r.duration : undefined,
    aircraft: r.aircraft_icao ? String(r.aircraft_icao) : undefined,
    source,
    fetchedAt,
  }
}

function nextRunYmdForDays(dayKeys: string[], from: Date): string | null {
  if (dayKeys.length === 0) {
    return from.toISOString().slice(0, 10)
  }
  const set = new Set(dayKeys.map((d) => d.toLowerCase()))
  for (let i = 0; i < 14; i++) {
    const t = new Date(from.getTime() + i * 24 * 3600 * 1000)
    const s = t.toISOString().slice(0, 10)
    const wk = DAY[t.getUTCDay()] ?? ''
    if (set.has(wk)) return s
  }
  return null
}

function routeToNextOccurrence(
  r: AirlabsRouteRow,
  fetchedAt: string,
  source: FlightSchedule['source'],
  flightIata: string,
): FlightSchedule | null {
  const days = (r.days) ?? []
  const ref = new Date()
  const y0 = nextRunYmdForDays(days, ref)
  if (!y0) return null
  return routeToFlightOnDate(r, y0, fetchedAt, source, flightIata)
}

function filterScheduleRowsByDate(
  rows: AirlabsScheduleRow[],
  ymd: string,
): AirlabsScheduleRow[] {
  return rows.filter((r) => {
    const depS =
      (typeof r.dep_time_utc === 'string' && r.dep_time_utc) ||
      (typeof r.dep_estimated_utc === 'string' && r.dep_estimated_utc) ||
      (typeof r.dep_actual_utc === 'string' && r.dep_actual_utc) ||
      ''
    if (!depS) return false
    if (depS.includes(' ') || depS.includes('T')) {
      const p = parseScheduleUtc(depS)
      return p?.dateStr === ymd
    }
    return false
  })
}

function unwrapCachePayload(
  row: { payload: unknown; fetchedAt: Date },
  flightIata: string,
  dateYmd: string | null,
): { ok: true; out: FlightSchedule[] } | { ok: false } {
  const p = row.payload
  if (Array.isArray(p)) {
    return {
      ok: true,
      out: p.map((x) => ({
        ...(x as FlightSchedule),
        source: 'cache' as const,
      })),
    }
  }
  if (p && typeof p === 'object' && 'v' in p && (p as { v: number }).v === 1) {
    const pl = p as CachePayload
    if (pl.t === 'dated') {
      return {
        ok: true,
        out: pl.items.map((s) => ({ ...s, source: 'cache' as const })),
      }
    }
    if (dateYmd) {
      return { ok: false }
    }
    const nd = pl
    const at = row.fetchedAt.toISOString()
    return {
      ok: true,
      out: nd.routes
        .map((r) => routeToNextOccurrence(r, at, 'cache', flightIata))
        .filter((x): x is FlightSchedule => x != null),
    }
  }
  return { ok: false }
}

export async function getFlightSchedules(
  rawFlight: string,
  dateStr: string | null,
): Promise<FlightSchedule[]> {
  const p = parseFlightIata(rawFlight)
  if (!p.ok) {
    throw new Error(p.error)
  }
  const { flightIata, airlineIata, flightNumber } = p
  const dateKey =
    dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : 'nodate'
  const ymd = dateKey === 'nodate' ? null : dateKey

  const now = new Date()
  const ttl = scheduleTtlMs()
  const cached = await prisma.airlabsScheduleCache.findUnique({
    where: { flightIata_dateKey: { flightIata, dateKey } },
  })
  if (cached) {
    const age = now.getTime() - cached.fetchedAt.getTime()
    if (age < ttl) {
      const u = unwrapCachePayload(cached, flightIata, ymd)
      if (u.ok && u.out.length > 0) {
        return u.out
      }
    }
  }

  const fetchedAt = new Date().toISOString()
  let fromSched: FlightSchedule[] = []
  if (ymd) {
    try {
      const sched = await fetchSchedulesByFlightIata(flightIata)
      const filtered = filterScheduleRowsByDate(sched, ymd)
      fromSched = filtered
        .map((r) => scheduleRowToFS(r, fetchedAt, 'airlabs', flightIata))
        .filter((x): x is FlightSchedule => x != null)
    } catch {
      /* routes only */
    }
  }

  const routeRows = await fetchRoutesByAirlineAndFlight(airlineIata, flightNumber)
  let fromRoutes: FlightSchedule[] = []
  if (ymd) {
    fromRoutes = routeRows
      .map((r) =>
        routeToFlightOnDate(r, ymd, fetchedAt, 'airlabs', flightIata),
      )
      .filter((x): x is FlightSchedule => x != null)
  } else {
    fromRoutes = routeRows
      .map((r) => routeToNextOccurrence(r, fetchedAt, 'airlabs', flightIata))
      .filter((x): x is FlightSchedule => x != null)
  }

  let merged: FlightSchedule[] = []
  if (ymd) {
    if (fromSched.length > 0) {
      const keys = new Set(
        fromSched.map(
          (s) => `${s.departure.airport}-${s.arrival.airport}`,
        ),
      )
      merged = [
        ...fromSched,
        ...fromRoutes.filter(
          (r) => !keys.has(`${r.departure.airport}-${r.arrival.airport}`),
        ),
      ]
    } else {
      merged = fromRoutes
    }
  } else {
    merged = fromRoutes
  }

  if (ymd) {
    const payload: CachePayloadDated = { v: 1, t: 'dated', items: merged }
    await prisma.airlabsScheduleCache.upsert({
      where: { flightIata_dateKey: { flightIata, dateKey: ymd } },
      create: {
        flightIata,
        dateKey: ymd,
        payload: payload,
      },
      update: {
        payload: payload,
        fetchedAt: new Date(),
      },
    })
  } else {
    const payload: CachePayloadNodate = { v: 1, t: 'nodate', routes: routeRows }
    await prisma.airlabsScheduleCache.upsert({
      where: { flightIata_dateKey: { flightIata, dateKey: 'nodate' } },
      create: {
        flightIata,
        dateKey: 'nodate',
        payload: payload as Prisma.InputJsonValue,
      },
      update: {
        payload: payload as Prisma.InputJsonValue,
        fetchedAt: new Date(),
      },
    })
  }

  return merged
}
