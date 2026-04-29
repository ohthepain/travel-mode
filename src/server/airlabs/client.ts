import type { Airline, Airport, City } from '../../lib/flight-data'
import type {
  AirlabsLiveFlightRow,
  AirlabsRouteRow,
  AirlabsScheduleRow,
} from './api-types'

const BASE = 'https://airlabs.co/api/v9'

function getKey(): string | null {
  const k = process.env.AIRLABS_API_KEY?.trim()
  return k && k.length > 0 ? k : null
}

export function getAirlabsApiKey(): string | null {
  return getKey()
}

type AirlabsEnvelope<T> = {
  request?: unknown
  response?: T
  error?: { message?: string; code?: string }
}

function extractArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) {
    return data
  }
  if (data && typeof data === 'object' && 'response' in data) {
    const o = data as AirlabsEnvelope<T>
    if (Array.isArray(o.response)) return o.response
  }
  if (data && typeof data === 'object' && 'data' in data) {
    const o = data
    if (Array.isArray(o.data)) {
      return o.data
    }
  }
  return []
}

function extractErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const o = data as { error?: { message?: string } }
  if (o.error && typeof o.error === 'object' && o.error.message) {
    return String(o.error.message)
  }
  return null
}

export async function airlabsFetchJson<T = unknown>(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const key = getKey()
  if (!key) {
    throw new Error('AIRLABS_API_KEY is not configured')
  }
  const u = new URL(`${BASE}${path.startsWith('/') ? path : `/${path}`}`)
  u.searchParams.set('api_key', key)
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    u.searchParams.set(k, String(v))
  }
  const res = await fetch(u.toString(), { headers: { Accept: 'application/json' } })
  const data = (await res.json().catch(() => ({}))) as T & Record<string, unknown>
  if (!res.ok) {
    const m =
      (data as { message?: string }).message ||
      (data as { error?: { message?: string } }).error?.message ||
      res.statusText
    throw new Error(`AirLabs HTTP ${res.status}: ${m}`)
  }
  const err = extractErrorMessage(data)
  if (err) throw new Error(err)
  return data
}

export async function fetchSchedulesByFlightIata(
  flightIata: string,
  limit = 200,
): Promise<AirlabsScheduleRow[]> {
  const data = await airlabsFetchJson<unknown>('/schedules', {
    flight_iata: flightIata,
    limit,
  })
  return extractArray<AirlabsScheduleRow>(data)
}

/** Real-time radar rows for a departure → arrival trunk (optionally narrowed by flight IATA number). */
export async function fetchFlightsDepArr(
  depIata: string,
  arrIata: string,
  opts?: { flightIata?: string; limit?: number },
): Promise<AirlabsLiveFlightRow[]> {
  const params: Record<string, string | number | undefined> = {
    dep_iata: depIata,
    arr_iata: arrIata,
    limit: opts?.limit ?? 100,
  }
  if (opts?.flightIata) params.flight_iata = opts.flightIata
  const data = await airlabsFetchJson<unknown>('/flights', params)
  return extractArray<AirlabsLiveFlightRow>(data)
}

/** Schedules narrowed by airports + flight; use departure-only or arrival-only endpoints per AirLabs. */
export async function fetchSchedulesDepFlight(
  depIata: string,
  flightIata: string,
  limit = 500,
): Promise<AirlabsScheduleRow[]> {
  const data = await airlabsFetchJson<unknown>('/schedules', {
    dep_iata: depIata,
    flight_iata: flightIata,
    limit,
  })
  return extractArray<AirlabsScheduleRow>(data)
}

/** All departures from an airport (no `flight_iata` filter). */
export async function fetchSchedulesDepOnly(
  depIata: string,
  limit = 500,
): Promise<AirlabsScheduleRow[]> {
  const data = await airlabsFetchJson<unknown>('/schedules', {
    dep_iata: depIata,
    limit,
  })
  return extractArray<AirlabsScheduleRow>(data)
}

export async function fetchSchedulesArrFlight(
  arrIata: string,
  flightIata: string,
  limit = 500,
): Promise<AirlabsScheduleRow[]> {
  const data = await airlabsFetchJson<unknown>('/schedules', {
    arr_iata: arrIata,
    flight_iata: flightIata,
    limit,
  })
  return extractArray<AirlabsScheduleRow>(data)
}

/** All arrivals at an airport (no `flight_iata` filter). */
export async function fetchSchedulesArrOnly(
  arrIata: string,
  limit = 500,
): Promise<AirlabsScheduleRow[]> {
  const data = await airlabsFetchJson<unknown>('/schedules', {
    arr_iata: arrIata,
    limit,
  })
  return extractArray<AirlabsScheduleRow>(data)
}

/** Try route + flight on schedules (timetable). Falls back callers may use dep-only + client filter if API rejects dual airport query. */
export async function fetchSchedulesDepArrFlight(
  depIata: string,
  arrIata: string,
  flightIata: string,
  limit = 500,
): Promise<AirlabsScheduleRow[]> {
  try {
    const data = await airlabsFetchJson<unknown>('/schedules', {
      dep_iata: depIata,
      arr_iata: arrIata,
      flight_iata: flightIata,
      limit,
    })
    return extractArray<AirlabsScheduleRow>(data)
  } catch {
    const fallback = await fetchSchedulesDepFlight(depIata, flightIata, limit)
    return fallback.filter(
      (r) => String(r.arr_iata ?? '').toUpperCase() === arrIata,
    )
  }
}

/** Route timetable without narrowing by flight. */
export async function fetchSchedulesDepArrNoFlight(
  depIata: string,
  arrIata: string,
  limit = 500,
): Promise<AirlabsScheduleRow[]> {
  try {
    const data = await airlabsFetchJson<unknown>('/schedules', {
      dep_iata: depIata,
      arr_iata: arrIata,
      limit,
    })
    return extractArray<AirlabsScheduleRow>(data)
  } catch {
    const dep = await fetchSchedulesDepOnly(depIata, limit)
    return dep.filter(
      (r) => String(r.arr_iata ?? '').toUpperCase() === arrIata,
    )
  }
}

export async function fetchRoutesByAirlineAndFlight(
  airlineIata: string,
  flightNumber: string,
  limit = 200,
): Promise<AirlabsRouteRow[]> {
  const data = await airlabsFetchJson<unknown>('/routes', {
    airline_iata: airlineIata,
    flight_number: flightNumber,
    limit,
  })
  return extractArray<AirlabsRouteRow>(data)
}

export async function fetchAirport(
  iata: string,
): Promise<Record<string, unknown> | null> {
  const data = await airlabsFetchJson<unknown>('/airports', { iata_code: iata })
  const list = extractArray<Record<string, unknown>>(data)
  return list[0] ?? null
}

export async function fetchAirline(
  iata: string,
): Promise<Record<string, unknown> | null> {
  const data = await airlabsFetchJson<unknown>('/airlines', { iata_code: iata })
  const list = extractArray<Record<string, unknown>>(data)
  return list[0] ?? null
}

export async function fetchCity(
  cityCode: string,
): Promise<Record<string, unknown> | null> {
  const data = await airlabsFetchJson<unknown>('/cities', { city_code: cityCode })
  const list = extractArray<Record<string, unknown>>(data)
  return list[0] ?? null
}

export function mapAirportRow(r: Record<string, unknown>): Airport {
  return {
    iataCode: String(r.iata_code ?? ''),
    icaoCode: r.icao_code ? String(r.icao_code) : undefined,
    name: String(r.name ?? ''),
    cityCode: String(r.city_code ?? ''),
    countryCode: String(r.country_code ?? ''),
    lat: num(r.lat),
    lon: num(r.lng),
  }
}

export function mapAirlineRow(r: Record<string, unknown>): Airline {
  return {
    iataCode: String(r.iata_code ?? ''),
    icaoCode: r.icao_code ? String(r.icao_code) : undefined,
    name: String(r.name ?? ''),
    countryCode: String(r.country_code ?? ''),
  }
}

export function mapCityRow(r: Record<string, unknown>): City {
  return {
    code: String(r.city_code ?? ''),
    name: String(r.name ?? ''),
    countryCode: String(r.country_code ?? ''),
    latitude: num(r.lat),
    longitude: num(r.lng),
  }
}

function num(x: unknown): number {
  if (typeof x === 'number' && Number.isFinite(x)) return x
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)))
    return Number(x)
  return 0
}
