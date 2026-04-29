import { Hono } from 'hono'
import type { Prisma } from '../../../generated/prisma/client'
import type { Airline, Airport, City, FlightSchedule } from '../../lib/flight-data'
import { parseFlightIata } from '../../lib/flight-iata'
import type { AirlabsScheduleRow } from '../airlabs/api-types'
import { prisma } from '../db'
import { flightSyncUiState } from '../jobs/queue'
import {
  fetchAirline,
  fetchAirport,
  fetchCity,
  fetchFlightsDepArr,
  fetchSchedulesArrFlight,
  fetchSchedulesArrOnly,
  fetchSchedulesDepArrFlight,
  fetchSchedulesDepArrNoFlight,
  fetchSchedulesDepFlight,
  fetchSchedulesDepOnly,
  getAirlabsApiKey,
  mapAirlineRow,
  mapAirportRow,
  mapCityRow,
} from '../airlabs/client'
import {
  airlabsLiveFlightRowToFlightSchedule,
  airlabsScheduleRowToFlightSchedule,
  getFlightSchedules,
  refTtlMs,
} from '../airlabs/resolve-schedule'
import { airportIatasForCityCode } from '../catalog-airports'

const flightScheduleRoutes = new Hono()

function parseTripleLoc(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const x = raw.trim().toUpperCase()
  return /^[A-Z0-9]{3}$/.test(x) ? x : undefined
}

/** Airports matching a travel-city code from the bundled catalog (fallback: treat code as airport). */
function expandCityToAirports(cityToken: string): string[] {
  const xs = airportIatasForCityCode(cityToken)
  return xs.length > 0 ? xs : [cityToken]
}

function expandDepArrSide(
  rawAirport?: string,
  rawCity?: string,
):
  | { ok: false; error: string }
  | { ok: true; codes: string[] | undefined } {
  const airport = parseTripleLoc(rawAirport)
  const city = parseTripleLoc(rawCity)
  if (airport && city) {
    return { ok: false, error: 'Use airport or city for this side, not both.' }
  }
  if (city) return { ok: true, codes: expandCityToAirports(city) }
  if (airport) return { ok: true, codes: [airport] }
  return { ok: true, codes: undefined }
}
const airportRoutes = new Hono()
const airlineRoutes = new Hono()
const cityRoutes = new Hono()

function dedupeSchedulesByLegAndTime(
  rows: FlightSchedule[],
): FlightSchedule[] {
  const seen = new Set<string>()
  const out: FlightSchedule[] = []
  for (const s of rows) {
    const k = `${s.departure.time}|${s.departure.airport}|${s.arrival.airport}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out.sort((a, b) =>
    a.departure.time.localeCompare(b.departure.time),
  )
}

/** Label parseable by `parseFlightIata` for mapping a timetable row without a caller-supplied flight. */
function flightLabelForScheduleRow(r: AirlabsScheduleRow): string | null {
  const fiRaw =
    typeof r.flight_iata === 'string'
      ? r.flight_iata.replace(/\s+/g, '').toUpperCase()
      : ''
  if (fiRaw) {
    const p = parseFlightIata(fiRaw)
    if (p.ok) return p.flightIata
  }
  const air =
    typeof r.airline_iata === 'string'
      ? r.airline_iata.trim().toUpperCase()
      : ''
  const numRaw =
    typeof r.flight_number === 'string'
      ? r.flight_number.replace(/\s+/g, '')
      : ''
  if (air && numRaw) {
    const combined = `${air}${numRaw}`
    const p = parseFlightIata(combined)
    if (p.ok) return p.flightIata
  }
  return null
}

flightScheduleRoutes.get('/', async (c) => {
  if (!getAirlabsApiKey()) {
    return c.json(
      { error: 'AirLabs is not configured (set AIRLABS_API_KEY).' },
      503,
    )
  }
  const fn = c.req.query('flightNumber')?.trim()
  const date = c.req.query('date')?.trim()
  const rawDep = c.req.query('dep_iata')?.trim()
  const rawArr = c.req.query('arr_iata')?.trim()
  const rawDepCity = c.req.query('dep_city')?.trim()
  const rawArrCity = c.req.query('arr_city')?.trim()

  const depSide = expandDepArrSide(rawDep, rawDepCity)
  const arrSide = expandDepArrSide(rawArr, rawArrCity)
  if (!depSide.ok) {
    return c.json({ error: depSide.error }, 400)
  }
  if (!arrSide.ok) {
    return c.json({ error: arrSide.error }, 400)
  }

  const depList = depSide.codes
  const arrList = arrSide.codes
  const hasDepSide = Boolean(depList?.length)
  const hasArrSide = Boolean(arrList?.length)

  if (!fn?.length && !hasDepSide && !hasArrSide) {
    return c.json(
      {
        error:
          'Provide flightNumber (optional with airports/cities) and/or departure and/or arrival (airports via dep_iata/arr_iata or travel cities via dep_city/arr_city).',
      },
      400,
    )
  }

  const parsed = fn ? parseFlightIata(fn) : null
  if (fn && (!parsed || !parsed.ok)) {
    return c.json({ error: 'invalid flightNumber' }, 400)
  }

  /** Set when `flightNumber` parses as a valid IATA flight id; used for airline API filters. */
  const flightParsed = parsed && parsed.ok ? parsed : null

  if (!hasDepSide && !hasArrSide && date != null && date.length > 0) {
    const d = new Date(`${date.slice(0, 10)}T00:00:00.000Z`)
    if (Number.isNaN(d.getTime())) {
      return c.json({ error: 'invalid date' }, 400)
    }
  }

  try {
    const fetchedAt = new Date().toISOString()

    async function depArrPair(depAP: string, arrAP: string): Promise<FlightSchedule[]> {
      const flightIata = flightParsed?.flightIata
      const liveRows = await fetchFlightsDepArr(
        depAP,
        arrAP,
        flightIata
          ? { flightIata, limit: 100 }
          : { limit: 100 },
      )
      const fromLive = liveRows
        .map((r) =>
          flightIata
            ? airlabsLiveFlightRowToFlightSchedule(r, fetchedAt, flightIata)
            : airlabsLiveFlightRowToFlightSchedule(r, fetchedAt),
        )
        .filter((x): x is FlightSchedule => x != null)

      const timetableRows =
        flightIata != null
          ? await fetchSchedulesDepArrFlight(depAP, arrAP, flightIata)
          : await fetchSchedulesDepArrNoFlight(depAP, arrAP)

      const fromSchedules = timetableRows
        .map((r) => {
          const lab = flightLabelForScheduleRow(r)
          if (!lab) return null
          return airlabsScheduleRowToFlightSchedule(r, fetchedAt, lab)
        })
        .filter((x): x is FlightSchedule => x != null)

      return [...fromLive, ...fromSchedules]
    }

    async function schedulesForDep(depAP: string): Promise<FlightSchedule[]> {
      const raw = flightParsed
        ? await fetchSchedulesDepFlight(depAP, flightParsed.flightIata)
        : await fetchSchedulesDepOnly(depAP)
      return raw
        .map((r) => {
          const lab = flightParsed?.flightIata ?? flightLabelForScheduleRow(r)
          if (!lab) return null
          return airlabsScheduleRowToFlightSchedule(r, fetchedAt, lab)
        })
        .filter((x): x is FlightSchedule => x != null)
    }

    async function schedulesForArr(arrAP: string): Promise<FlightSchedule[]> {
      const raw = flightParsed
        ? await fetchSchedulesArrFlight(arrAP, flightParsed.flightIata)
        : await fetchSchedulesArrOnly(arrAP)
      return raw
        .map((r) => {
          const lab = flightParsed?.flightIata ?? flightLabelForScheduleRow(r)
          if (!lab) return null
          return airlabsScheduleRowToFlightSchedule(r, fetchedAt, lab)
        })
        .filter((x): x is FlightSchedule => x != null)
    }

    let schedules: FlightSchedule[]

    if (hasDepSide && hasArrSide && depList && arrList) {
      const acc: FlightSchedule[] = []
      for (const dep of depList) {
        for (const arr of arrList) {
          acc.push(...(await depArrPair(dep, arr)))
        }
      }
      schedules = dedupeSchedulesByLegAndTime(acc)
    } else if (hasDepSide && depList) {
      const acc: FlightSchedule[] = []
      for (const dep of depList) {
        acc.push(...(await schedulesForDep(dep)))
      }
      schedules = dedupeSchedulesByLegAndTime(acc)
    } else if (hasArrSide && arrList) {
      const acc: FlightSchedule[] = []
      for (const arr of arrList) {
        acc.push(...(await schedulesForArr(arr)))
      }
      schedules = dedupeSchedulesByLegAndTime(acc)
    } else {
      if (!fn) {
        return c.json(
          {
            error:
              'flightNumber is required when departure and arrival are not specified',
          },
          400,
        )
      }
      schedules = await getFlightSchedules(
        fn,
        date && date.length > 0 ? date.slice(0, 10) : null,
      )
    }
    const uniqueFns = [
      ...new Set(
        schedules.map((s) => s.flightNumber.replace(/\s+/g, '').toUpperCase()),
      ),
    ].filter((n) => n.length > 0)
    const syncList = await Promise.all(
      uniqueFns.map((n) => flightSyncUiState(n)),
    )
    const syncByFn = new Map(
      uniqueFns.map((n, i) => [n, syncList[i]] as const),
    )
    const schedulesWithSync = schedules.map((s) => {
      const key = s.flightNumber.replace(/\s+/g, '').toUpperCase()
      return {
        ...s,
        syncStatus:
          syncByFn.get(key) ?? { synced: false, jobActive: false },
      }
    })
    return c.json({ schedules: schedulesWithSync })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'schedule lookup failed'
    if (msg === 'invalid_flightNumber' || msg === 'empty_flightNumber') {
      return c.json({ error: 'invalid flightNumber' }, 400)
    }
    return c.json({ error: msg }, 502)
  }
})

async function upsertAirportFromApi(
  iata: string,
): Promise<Airport | null> {
  const raw = await fetchAirport(iata)
  if (!raw) return null
  const a = mapAirportRow(raw)
  await prisma.airlabsAirport.upsert({
    where: { iataCode: a.iataCode },
    create: {
      iataCode: a.iataCode,
      icaoCode: a.icaoCode ?? null,
      name: a.name,
      cityCode: a.cityCode,
      countryCode: a.countryCode,
      lat: a.lat,
      lon: a.lon,
      rawJson: raw as Prisma.InputJsonValue,
    },
    update: {
      icaoCode: a.icaoCode ?? null,
      name: a.name,
      cityCode: a.cityCode,
      countryCode: a.countryCode,
      lat: a.lat,
      lon: a.lon,
      rawJson: raw as Prisma.InputJsonValue,
      fetchedAt: new Date(),
    },
  })
  return a
}

airportRoutes.get('/', async (c) => {
  if (!getAirlabsApiKey()) {
    return c.json(
      { error: 'AirLabs is not configured (set AIRLABS_API_KEY).' },
      503,
    )
  }
  const iata = c.req.query('iata')?.trim().toUpperCase()
  if (iata) {
    const row = await prisma.airlabsAirport.findUnique({
      where: { iataCode: iata },
    })
    const ttl = refTtlMs()
    const fresh =
      row && Date.now() - row.fetchedAt.getTime() < ttl
    if (fresh) {
      return c.json({
        airport: {
          iataCode: row.iataCode,
          icaoCode: row.icaoCode ?? undefined,
          name: row.name,
          cityCode: row.cityCode,
          countryCode: row.countryCode,
          lat: row.lat,
          lon: row.lon,
        } satisfies Airport,
        source: 'cache' as const,
        fetchedAt: row.fetchedAt.toISOString(),
      })
    }
    try {
      const a = await upsertAirportFromApi(iata)
      if (!a) return c.json({ error: 'airport not found' }, 404)
      return c.json({
        airport: a,
        source: 'airlabs' as const,
        fetchedAt: new Date().toISOString(),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'lookup failed'
      return c.json({ error: msg }, 502)
    }
  }

  const rows = await prisma.airlabsAirport.findMany({
    orderBy: { iataCode: 'asc' },
  })
  return c.json({
    airports: rows.map(
      (row): Airport => ({
        iataCode: row.iataCode,
        icaoCode: row.icaoCode ?? undefined,
        name: row.name,
        cityCode: row.cityCode,
        countryCode: row.countryCode,
        lat: row.lat,
        lon: row.lon,
      }),
    ),
    count: rows.length,
  })
})

async function upsertAirlineFromApi(
  iata: string,
): Promise<Airline | null> {
  const raw = await fetchAirline(iata)
  if (!raw) return null
  const a = mapAirlineRow(raw)
  await prisma.airlabsAirline.upsert({
    where: { iataCode: a.iataCode },
    create: {
      iataCode: a.iataCode,
      icaoCode: a.icaoCode ?? null,
      name: a.name,
      countryCode: a.countryCode,
      rawJson: raw as Prisma.InputJsonValue,
    },
    update: {
      icaoCode: a.icaoCode ?? null,
      name: a.name,
      countryCode: a.countryCode,
      rawJson: raw as Prisma.InputJsonValue,
      fetchedAt: new Date(),
    },
  })
  return a
}

airlineRoutes.get('/', async (c) => {
  if (!getAirlabsApiKey()) {
    return c.json(
      { error: 'AirLabs is not configured (set AIRLABS_API_KEY).' },
      503,
    )
  }
  const iata = c.req.query('iata')?.trim().toUpperCase()
  if (iata) {
    const row = await prisma.airlabsAirline.findUnique({
      where: { iataCode: iata },
    })
    const ttl = refTtlMs()
    const fresh =
      row && Date.now() - row.fetchedAt.getTime() < ttl
    if (fresh) {
      return c.json({
        airline: {
          iataCode: row.iataCode,
          icaoCode: row.icaoCode ?? undefined,
          name: row.name,
          countryCode: row.countryCode,
        } satisfies Airline,
        source: 'cache' as const,
        fetchedAt: row.fetchedAt.toISOString(),
      })
    }
    try {
      const a = await upsertAirlineFromApi(iata)
      if (!a) return c.json({ error: 'airline not found' }, 404)
      return c.json({
        airline: a,
        source: 'airlabs' as const,
        fetchedAt: new Date().toISOString(),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'lookup failed'
      return c.json({ error: msg }, 502)
    }
  }

  const rows = await prisma.airlabsAirline.findMany({
    orderBy: { iataCode: 'asc' },
  })
  return c.json({
    airlines: rows.map(
      (row): Airline => ({
        iataCode: row.iataCode,
        icaoCode: row.icaoCode ?? undefined,
        name: row.name,
        countryCode: row.countryCode,
      }),
    ),
    count: rows.length,
  })
})

async function upsertCityFromApi(code: string): Promise<City | null> {
  const raw = await fetchCity(code)
  if (!raw) return null
  const a = mapCityRow(raw)
  await prisma.airlabsCity.upsert({
    where: { cityCode: a.code },
    create: {
      cityCode: a.code,
      name: a.name,
      countryCode: a.countryCode,
      lat: a.latitude,
      lon: a.longitude,
      rawJson: raw as Prisma.InputJsonValue,
    },
    update: {
      name: a.name,
      countryCode: a.countryCode,
      lat: a.latitude,
      lon: a.longitude,
      rawJson: raw as Prisma.InputJsonValue,
      fetchedAt: new Date(),
    },
  })
  return a
}

cityRoutes.get('/', async (c) => {
  if (!getAirlabsApiKey()) {
    return c.json(
      { error: 'AirLabs is not configured (set AIRLABS_API_KEY).' },
      503,
    )
  }
  const city = c.req.query('city')?.trim().toUpperCase()
  if (city) {
    const row = await prisma.airlabsCity.findUnique({
      where: { cityCode: city },
    })
    const ttl = refTtlMs()
    const fresh =
      row && Date.now() - row.fetchedAt.getTime() < ttl
    if (fresh) {
      return c.json({
        city: {
          code: row.cityCode,
          name: row.name,
          countryCode: row.countryCode,
          latitude: row.lat,
          longitude: row.lon,
        } satisfies City,
        source: 'cache' as const,
        fetchedAt: row.fetchedAt.toISOString(),
      })
    }
    try {
      const a = await upsertCityFromApi(city)
      if (!a) return c.json({ error: 'city not found' }, 404)
      return c.json({
        city: a,
        source: 'airlabs' as const,
        fetchedAt: new Date().toISOString(),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'lookup failed'
      return c.json({ error: msg }, 502)
    }
  }

  const rows = await prisma.airlabsCity.findMany({
    orderBy: { cityCode: 'asc' },
  })
  return c.json({
    cities: rows.map(
      (row): City => ({
        code: row.cityCode,
        name: row.name,
        countryCode: row.countryCode,
        latitude: row.lat,
        longitude: row.lon,
      }),
    ),
    count: rows.length,
  })
})

export { flightScheduleRoutes, airportRoutes, airlineRoutes, cityRoutes }
