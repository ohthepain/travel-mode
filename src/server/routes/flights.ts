import { Hono } from 'hono'
import { prisma } from '../db'
import {
  enqueueSyncFlight,
  enqueueSyncFlightMany,
  flightAlreadySynced,
  flightSyncUiState,
} from '../jobs/queue'
import type { Feature, LineString } from 'geojson'
import { featureCollection } from '../geojson'
import { effectiveFlightMapBbox } from '../../lib/route-bbox-expand'
import { getSessionUserId } from '../session'
import {
  dedupeFr24SummaryRows,
  expandFlightNumberCandidates,
  expandFr24CallsignCandidates,
  fr24Request,
  getFr24Client,
  normalizeIataFlightLabel,
  parseSummaryRows,
  fr24RowHasNoDateSignals,
  fr24SummaryWindowAroundTravelDate,
  summaryRowMatchesTravelDate,
  type Fr24SummaryRow,
} from '../fr24/client'
import { Prisma } from '../../../generated/prisma/client'

/**
 * @query date — optional; calendar date in UTC (`YYYY-MM-DD`). Omit to return all stored tracks for the flight.
 */
export const flightRoutes = new Hono()

flightRoutes.get('/search', async (c) => {
  const rawFn = c.req.query('flightNumber')
  const date = c.req.query('date')
  const flightNumber = rawFn?.trim().toUpperCase()
  if (!flightNumber || !date?.trim()) {
    return c.json({ error: 'flightNumber and date are required' }, 400)
  }
  const day = new Date(`${date.trim()}T00:00:00.000Z`)
  if (Number.isNaN(day.getTime())) {
    return c.json({ error: 'invalid date' }, 400)
  }

  const client = getFr24Client()
  if (!client) {
    return c.json(
      { error: 'Flight search is unavailable (configure FLIGHTRADAR24_API_TOKEN).' },
      503,
    )
  }

  try {
    const travelDateIso = date.trim().slice(0, 10)
    const routeFrom = c.req.query('from')?.trim().toUpperCase()
    const routeTo = c.req.query('to')?.trim().toUpperCase()
    const validRoute =
      routeFrom &&
      routeTo &&
      /^[A-Z]{3}$/.test(routeFrom) &&
      /^[A-Z]{3}$/.test(routeTo)

    const { from: flight_datetime_from, to: flight_datetime_to } =
      fr24SummaryWindowAroundTravelDate(travelDateIso)
    const fr24FlightCandidates = expandFlightNumberCandidates(flightNumber)
    const candidateSet = new Set(
      fr24FlightCandidates.map((x) => normalizeIataFlightLabel(x)),
    )
    const callsignCandidates = expandFr24CallsignCandidates(flightNumber)

    /** Upcoming legs often have no times yet; keep those only for direct flight/callsign queries. */
    const filterIataOrCallsign = (parsed: Fr24SummaryRow[]) =>
      parsed.filter((r) => {
        if (!candidateSet.has(normalizeIataFlightLabel(r.flightNumber)))
          return false
        if (summaryRowMatchesTravelDate(r, travelDateIso)) return true
        if (fr24RowHasNoDateSignals(r)) return true
        return false
      })

    const filterRoute = (parsed: Fr24SummaryRow[]) =>
      parsed.filter(
        (r) =>
          candidateSet.has(normalizeIataFlightLabel(r.flightNumber)) &&
          summaryRowMatchesTravelDate(r, travelDateIso),
      )

    let merged: Fr24SummaryRow[] = []

    merged = filterIataOrCallsign(
      parseSummaryRows(
        await fr24Request(() =>
          client.flightSummary.getFull({
            flight_datetime_from,
            flight_datetime_to,
            flights: fr24FlightCandidates,
            limit: 100,
          }),
        ),
      ),
    )

    if (!merged.length && callsignCandidates.length > 0) {
      merged = filterIataOrCallsign(
        parseSummaryRows(
          await fr24Request(() =>
            client.flightSummary.getFull({
              flight_datetime_from,
              flight_datetime_to,
              callsigns: callsignCandidates,
              limit: 100,
            }),
          ),
        ),
      )
    }

    if (!merged.length && validRoute) {
      merged = filterRoute(
        parseSummaryRows(
          await fr24Request(() =>
            client.flightSummary.getFull({
              flight_datetime_from,
              flight_datetime_to,
              routes: `${routeFrom}-${routeTo}`,
              limit: 10_000,
            }),
          ),
        ),
      )
    }

    const rows = dedupeFr24SummaryRows(merged)
    const results = rows.map((r) => {
      const s = r.schedule
      return {
        fr24FlightId: r.fr24FlightId,
        flightNumber: r.flightNumber,
        travelDate: travelDateIso,
        originIata: s.originIata,
        destIata: s.destIata,
        scheduledDeparture: s.scheduledDeparture?.toISOString() ?? null,
        scheduledArrival: s.scheduledArrival?.toISOString() ?? null,
        takeoffAt: s.takeoffAt?.toISOString() ?? null,
        landedAt: s.landedAt?.toISOString() ?? null,
      }
    })

    const uniqueFns = [
      ...new Set(
        results.map((r) => r.flightNumber.replace(/\s+/g, '').toUpperCase()),
      ),
    ]
    const syncByFn = new Map<string, { synced: boolean; jobActive: boolean }>()
    try {
      await Promise.all(
        uniqueFns.map(async (fn) => {
          const st = await flightSyncUiState(fn)
          syncByFn.set(fn, st)
        }),
      )
    } catch {
      /* ignore — omit sync metadata */
    }
    const resultsWithSync = results.map((r) => {
      const fn = r.flightNumber.replace(/\s+/g, '').toUpperCase()
      const syncStatus = syncByFn.get(fn) ?? { synced: false, jobActive: false }
      return { ...r, syncStatus }
    })

    return c.json({
      results: resultsWithSync,
      searchNote:
        resultsWithSync.length === 0
          ? 'This search uses the Flightradar24 API, which can list a flight for one date but not for another: legs usually appear there after the aircraft is on the network, not on a full timetable like FlightAware. You may see the same number for yesterday but not for today; try again closer to departure or after takeoff. Optional: IATA (D8/DY/4322) and origin/destination to search the route.'
          : undefined,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'search failed'
    return c.json({ error: msg }, 502)
  } finally {
    client.close()
  }
})

flightRoutes.get('/saved', async (c) => {
  const userId = await getSessionUserId(c.req.raw.headers)
  if (!userId) return c.json({ error: 'unauthorized' }, 401)

  const rows = await prisma.userSavedFlight.findMany({
    where: { userId },
    orderBy: [{ travelDate: 'asc' }, { scheduledDeparture: 'asc' }],
  })
  return c.json({
    flights: rows.map((r) => ({
      id: r.id,
      flightNumber: r.flightNumber,
      travelDate: r.travelDate.toISOString().slice(0, 10),
      fr24FlightId: r.fr24FlightId,
      originIata: r.originIata,
      destIata: r.destIata,
      scheduledDeparture: r.scheduledDeparture?.toISOString() ?? null,
      scheduledArrival: r.scheduledArrival?.toISOString() ?? null,
      takeoffAt: r.takeoffAt?.toISOString() ?? null,
    })),
  })
})

flightRoutes.post('/saved', async (c) => {
  const userId = await getSessionUserId(c.req.raw.headers)
  if (!userId) return c.json({ error: 'unauthorized' }, 401)

  const body = await c.req.json().catch(() => ({}))
  const flightNumber = String(body.flightNumber ?? '')
    .trim()
    .toUpperCase()
  const travelRaw = String(body.travelDate ?? '').trim()
  if (!flightNumber || !travelRaw) {
    return c.json({ error: 'flightNumber and travelDate required' }, 400)
  }
  const travelDay = new Date(`${travelRaw.slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(travelDay.getTime())) {
    return c.json({ error: 'invalid travelDate' }, 400)
  }

  const fr24FlightId =
    typeof body.fr24FlightId === 'string' && body.fr24FlightId.length > 0
      ? body.fr24FlightId
      : null
  const originIata =
    typeof body.originIata === 'string' ? body.originIata : null
  const destIata = typeof body.destIata === 'string' ? body.destIata : null
  const scheduledDeparture = parseOptionalIso(body.scheduledDeparture)
  const scheduledArrival = parseOptionalIso(body.scheduledArrival)
  const takeoffAt = parseOptionalIso(body.takeoffAt)

  try {
    const row = await prisma.userSavedFlight.create({
      data: {
        userId,
        flightNumber,
        travelDate: travelDay,
        fr24FlightId,
        originIata,
        destIata,
        scheduledDeparture,
        scheduledArrival,
        takeoffAt,
      },
    })
    try {
      await enqueueSyncFlight(flightNumber)
    } catch {
      /* best-effort: saved flight still succeeds */
    }
    return c.json({
      ok: true,
      flight: {
        id: row.id,
        flightNumber: row.flightNumber,
        travelDate: row.travelDate.toISOString().slice(0, 10),
        fr24FlightId: row.fr24FlightId,
        originIata: row.originIata,
        destIata: row.destIata,
        scheduledDeparture: row.scheduledDeparture?.toISOString() ?? null,
        scheduledArrival: row.scheduledArrival?.toISOString() ?? null,
        takeoffAt: row.takeoffAt?.toISOString() ?? null,
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return c.json({ error: 'already_saved', message: 'This flight is already on your list.' }, 409)
    }
    throw e
  }
})

flightRoutes.delete('/saved/:id', async (c) => {
  const userId = await getSessionUserId(c.req.raw.headers)
  if (!userId) return c.json({ error: 'unauthorized' }, 401)
  const id = c.req.param('id')
  const r = await prisma.userSavedFlight.deleteMany({ where: { id, userId } })
  if (r.count === 0) return c.json({ error: 'not_found' }, 404)
  return c.json({ ok: true })
})

flightRoutes.get('/:flightNumber/tracks', async (c) => {
  const flightNumber = c.req.param('flightNumber').toUpperCase()
  const date = c.req.query('date')
  const where: { flightNumber: string; travelDate?: Date } = { flightNumber }
  if (date !== undefined && date !== '') {
    const d = new Date(date + 'T00:00:00.000Z')
    if (Number.isNaN(d.getTime())) {
      return c.json({ error: 'invalid date' }, 400)
    }
    where.travelDate = d
  }
  const tracks = await prisma.track.findMany({
    where,
    orderBy: [{ travelDate: 'desc' }, { fetchedAt: 'asc' }],
  })
  const coll = featureCollection(tracks)
  const corridor = tracks.find((t) => t.corridorGeojson) ?? null
  const bbox = tracks.find((t) => t.bbox) ?? null
  const firstLine: Feature<LineString> | null = coll.features[0] ?? null
  const rawBbox = jsonLonLatBBox(bbox?.bbox)
  const dates = [
    ...new Set(tracks.map((t) => t.travelDate.toISOString().slice(0, 10))),
  ].sort()
  return c.json({
    type: 'FeatureCollection',
    features: coll.features,
    meta: {
      flightNumber,
      date: date ?? null,
      dates,
      count: tracks.length,
      bbox: effectiveFlightMapBbox(firstLine, rawBbox),
      corridor: corridor?.corridorGeojson ?? null,
    },
  })
})

const queueBody = (b: { flightNumber?: string; flightNumbers?: unknown }) => {
  if (Array.isArray(b.flightNumbers) && b.flightNumbers.length > 0) return null
  if (b.flightNumber) return null
  return { error: 'flightNumber or non-empty flightNumbers[] required' } as const
}

flightRoutes.post('/queue', async (c) => {
  const body = (await c.req
    .json()
    .catch(() => ({}))) as { flightNumber?: string; flightNumbers?: unknown }
  const err = queueBody(body)
  if (err) return c.json(err, 400)

  if (Array.isArray(body.flightNumbers) && body.flightNumbers.length > 0) {
    const flightNumbers = body.flightNumbers
      .map((x: unknown) => String(x).toUpperCase().trim())
      .filter(Boolean)
    if (process.env.SKIP_FR24_IF_SYNCED === '1') {
      const synced = await Promise.all(
        flightNumbers.map((n: string) => flightAlreadySynced(n)),
      )
      if (synced.every(Boolean)) {
        return c.json({ ok: true, skipped: true, reason: 'already_synced' }, 200)
      }
    }
    const id = await enqueueSyncFlightMany(flightNumbers)
    return c.json({ ok: true, jobId: id, queued: true, flightNumbers }, 202)
  }

  const flightNumber = String(body.flightNumber).toUpperCase()
  if (process.env.SKIP_FR24_IF_SYNCED === '1' && (await flightAlreadySynced(flightNumber))) {
    return c.json({ ok: true, skipped: true, reason: 'already_synced' }, 200)
  }
  const id = await enqueueSyncFlight(flightNumber)
  return c.json({ ok: true, jobId: id, queued: true }, 202)
})

function parseOptionalIso(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.length) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function jsonLonLatBBox(v: unknown): [number, number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 4) return null
  if (!v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return v as [number, number, number, number]
}
