import { Hono } from 'hono'
import { prisma } from '../db'
import {
  enqueueSyncFlight,
  enqueueSyncFlightMany,
  flightAlreadySynced,
} from '../jobs/queue'
import { featureCollection } from '../geojson'

/**
 * @query date — optional; calendar date in UTC (`YYYY-MM-DD`). Omit to return all stored tracks for the flight.
 */
export const flightRoutes = new Hono()

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
      bbox: bbox?.bbox ?? null,
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
  const body = await c.req
    .json()
    .catch(() => ({}))
  const err = queueBody(body)
  if (err) return c.json(err, 400)

  if (Array.isArray(body.flightNumbers) && body.flightNumbers.length > 0) {
    const flightNumbers = body.flightNumbers
      .map((x) => String(x).toUpperCase().trim())
      .filter(Boolean)
    if (process.env.SKIP_FR24_IF_SYNCED === '1') {
      const synced = await Promise.all(
        flightNumbers.map((n) => flightAlreadySynced(n)),
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
