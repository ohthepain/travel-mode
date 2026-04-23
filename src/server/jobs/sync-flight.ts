import type { Job } from 'pg-boss'
import type { Prisma } from '../../../generated/prisma/client'
import { prisma } from '../db'
import { buildCorridorAndBbox, lineFromCoords } from '../precompute'
import {
  flightSummarySearchWindowUtc,
  fr24Request,
  getFr24Client,
  parseSummaryRows,
  trackResponseToLine,
  utcCalendarDateOnly,
} from '../fr24/client'
import type { Fr24SummaryRow } from '../fr24/client'
import { flightAlreadySynced } from './queue'
import { flightNumbersFromPayload } from './sync-payload'
import type { SyncFlightPayload } from './sync-payload'

export type { SyncFlightPayload } from './sync-payload'
export { flightNumbersFromPayload } from './sync-payload'

function scheduleToPrisma(s: Fr24SummaryRow['schedule']) {
  return {
    originIata: s.originIata,
    destIata: s.destIata,
    originIcao: s.originIcao,
    destIcao: s.destIcao,
    takeoffAt: s.takeoffAt,
    landedAt: s.landedAt,
    scheduledDeparture: s.scheduledDeparture,
    scheduledArrival: s.scheduledArrival,
    flightTimeSec: s.flightTimeSec,
    ...(s.scheduleJson != null ? { scheduleJson: s.scheduleJson as object } : {}),
  }
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

function rowMatchesRequested(
  row: Fr24SummaryRow,
  requested: string[],
): boolean {
  if (!requested.length) return true
  return requested.includes(row.flightNumber)
}

export async function syncFlightJob(p: SyncFlightPayload) {
  const flightNums = flightNumbersFromPayload(p)
  if (flightNums.length === 0) {
    throw new Error('sync_flight: flightNumber or non-empty flightNumbers is required')
  }

  if (process.env.SKIP_FR24_IF_SYNCED === '1') {
    const synced = await Promise.all(
      flightNums.map((n) => flightAlreadySynced(n)),
    )
    if (synced.every(Boolean)) {
      return
    }
  }

  const client = getFr24Client()
  let summaryRaw: unknown = null

  try {
    if (!client) {
      for (const flightNumber of flightNums) {
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
              routeGeojson: line as unknown as Prisma.InputJsonValue,
              corridorGeojson: corridor as object,
              bbox: bbox as object,
              firstTimestampMs: m.times[0] ?? null,
              lastTimestampMs: m.times[m.times.length - 1] ?? null,
              rawSummaryJson: { mock: true },
            },
            update: {
              routeGeojson: line as unknown as Prisma.InputJsonValue,
              corridorGeojson: corridor as object,
              bbox: bbox as object,
              firstTimestampMs: m.times[0] ?? null,
              lastTimestampMs: m.times[m.times.length - 1] ?? null,
              updatedAt: new Date(),
            },
          })
        } else {
          throw new Error(
            'FLIGHTRADAR24_API_TOKEN (or FR24_API_TOKEN) is not set and ALLOW_MOCK_FR24 is not 1',
          )
        }
      }
      return
    }

    const { flight_datetime_from, flight_datetime_to } = flightSummarySearchWindowUtc()
    const full = await fr24Request(() =>
      client.flightSummary.getFull({
        flight_datetime_from,
        flight_datetime_to,
        flights: flightNums,
      }),
    )
    summaryRaw = full
    const rows = parseSummaryRows(full).filter((r) => rowMatchesRequested(r, flightNums))

    for (const row of rows) {
      const { fr24FlightId, flightNumber } = row
      const commonSummary = { rawSummaryJson: summaryRaw as object }
      const sched = scheduleToPrisma(row.schedule)

      const existing = await prisma.track.findUnique({
        where: { fr24FlightId },
      })
      if (existing) {
        await prisma.track.update({
          where: { fr24FlightId },
          data: {
            ...sched,
            ...commonSummary,
            updatedAt: new Date(),
          },
        })
        continue
      }

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
          routeGeojson: line as unknown as Prisma.InputJsonValue,
          corridorGeojson: corridor as object,
          bbox: bbox as object,
          firstTimestampMs: times.length ? Math.min(...times) : null,
          lastTimestampMs: times.length ? Math.max(...times) : null,
          ...sched,
          ...commonSummary,
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
