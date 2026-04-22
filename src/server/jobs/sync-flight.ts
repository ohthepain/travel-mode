import type { Job } from 'pg-boss'
import { prisma } from '../db'
import { buildCorridorAndBbox, lineFromCoords } from '../precompute'
import {
  flightSummarySearchWindowUtc,
  fr24Request,
  getFr24Client,
  parseSummaryFlightIds,
  trackResponseToLine,
  utcCalendarDateOnly,
} from '../fr24/client'

export type SyncFlightPayload = {
  flightNumber: string
}

function mockTrackForDev(flightNumber: string) {
  const coords: [number, number][] = [
    [-122.3, 47.4],
    [-100.0, 45.0],
    [-80.0, 42.0],
    [-3.4, 40.4],
  ]
  const t0 = Date.now() - 8 * 60 * 60 * 1000
  return {
    coords,
    times: coords.map((_, i) => t0 + i * 2.5 * 60 * 60 * 1000),
    id: 'mock-' + flightNumber,
  }
}

export async function syncFlightJob(p: SyncFlightPayload) {
  const flightNumber = p.flightNumber.toUpperCase()

  const client = getFr24Client()
  let summaryRaw: unknown = null
  const flightIds: { id: string; label?: string }[] = []

  try {
    if (!client) {
      if (process.env.ALLOW_MOCK_FR24 === '1') {
        const m = mockTrackForDev(flightNumber)
        const line = lineFromCoords(m.coords)
        const { corridor, bbox } = buildCorridorAndBbox(m.coords)
        const travelDate = utcCalendarDateOnly(Date.now())
        await prisma.track.upsert({
          where: { fr24FlightId: m.id },
          create: {
            flightNumber,
            travelDate,
            fr24FlightId: m.id,
            routeGeojson: line,
            corridorGeojson: corridor,
            bbox: bbox as object,
            firstTimestampMs: m.times[0] ?? null,
            lastTimestampMs: m.times[m.times.length - 1] ?? null,
            rawSummaryJson: { mock: true } as object,
          },
          update: {
            routeGeojson: line,
            corridorGeojson: corridor,
            bbox: bbox as object,
            firstTimestampMs: m.times[0] ?? null,
            lastTimestampMs: m.times[m.times.length - 1] ?? null,
            updatedAt: new Date(),
          },
        })
        return
      }
      throw new Error(
        'FLIGHTRADAR24_API_TOKEN (or FR24_API_TOKEN) is not set and ALLOW_MOCK_FR24 is not 1',
      )
    }

    const { flight_datetime_from, flight_datetime_to } = flightSummarySearchWindowUtc()
    const light = await fr24Request(() =>
      client.flightSummary.getLight({
        flight_datetime_from,
        flight_datetime_to,
        flights: [flightNumber],
      }),
    )
    summaryRaw = light
    flightIds.push(...parseSummaryFlightIds(light))

    for (const { id: fr24FlightId } of flightIds) {
      const existing = await prisma.track.findUnique({ where: { fr24FlightId } })
      if (existing) continue
      const tr = await fr24Request(() => client.flightTracks.get(fr24FlightId))
      const { coords, times: times1 } = trackResponseToLine(tr)
      if (coords.length < 2) continue
      const line = lineFromCoords(coords)
      const { corridor, bbox } = buildCorridorAndBbox(coords)
      const times = times1.filter((t) => t > 0)
      const travelDate = utcCalendarDateOnly(
        times.length ? Math.min(...times) : Date.now(),
      )
      await prisma.track.create({
        data: {
          flightNumber,
          travelDate,
          fr24FlightId,
          routeGeojson: line,
          corridorGeojson: corridor,
          bbox: bbox as object,
          firstTimestampMs: times.length ? Math.min(...times) : null,
          lastTimestampMs: times.length ? Math.max(...times) : null,
          rawSummaryJson: summaryRaw as object,
        },
      })
    }
  } finally {
    client?.close()
  }
}

export async function handleSyncFlightBatches(
  jobs: Job<SyncFlightPayload>[],
) {
  for (const job of jobs) {
    await syncFlightJob(job.data)
  }
}
