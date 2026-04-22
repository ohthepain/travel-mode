import type { PgBoss } from 'pg-boss'
import { prisma } from '../db'
import { getFlightSummaryLookbackDays } from '../fr24/client'
import { getBoss } from './boss'
import type { SyncFlightPayload } from './sync-flight'

/** True if we already have any track for this flight in the current summary lookback window. */
export async function flightAlreadySynced(flightNumber: string) {
  const days = getFlightSummaryLookbackDays()
  const cutoff = new Date(Date.now() - days * 86_400_000)
  const from = new Date(
    Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), cutoff.getUTCDate()),
  )
  const n = await prisma.track.count({
    where: { flightNumber, travelDate: { gte: from } },
  })
  return n > 0
}

function jobKey(flightNumber: string) {
  return `sync_flight:${flightNumber}`
}

export async function enqueueSyncFlight(flightNumber: string) {
  const boss = await getBoss()
  const payload: SyncFlightPayload = { flightNumber }
  const key = jobKey(flightNumber)
  const id = await boss.send('sync_flight', payload, {
    singletonKey: key,
    retryLimit: 2,
  })
  return id ?? key
}

export async function enqueueSyncFlightWithBoss(boss: PgBoss, flightNumber: string) {
  const payload: SyncFlightPayload = { flightNumber }
  return boss.send('sync_flight', payload, {
    singletonKey: jobKey(flightNumber),
    retryLimit: 2,
  })
}
