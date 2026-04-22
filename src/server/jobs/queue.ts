import type { PgBoss } from 'pg-boss'
import { prisma } from '../db'
import { getFlightSummaryLookbackDays } from '../fr24/client'
import { getBoss } from './boss'
import type { SyncFlightPayload } from './sync-payload'
import { flightNumbersFromPayload } from './sync-payload'

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

function jobKeyFromPayload(p: SyncFlightPayload) {
  const nums = flightNumbersFromPayload(p)
  if (nums.length > 1) {
    return `sync_flight:${[...nums].sort().join(',')}`
  }
  if (nums.length === 1) {
    return `sync_flight:${nums[0]}`
  }
  return 'sync_flight:empty'
}

export async function enqueueSyncFlight(flightNumber: string) {
  const boss = await getBoss()
  const payload: SyncFlightPayload = { flightNumber }
  const id = await boss.send('sync_flight', payload, {
    singletonKey: jobKeyFromPayload(payload),
    retryLimit: 2,
  })
  return id ?? jobKeyFromPayload(payload)
}

/** One `getFull` for all numbers (see `SyncFlightPayload.flightNumbers`). */
export async function enqueueSyncFlightMany(flightNumbers: string[]) {
  const payload: SyncFlightPayload = { flightNumbers }
  if (flightNumbersFromPayload(payload).length === 0) {
    throw new Error('enqueueSyncFlightMany: at least one flight number required')
  }
  const boss = await getBoss()
  const id = await boss.send('sync_flight', payload, {
    singletonKey: jobKeyFromPayload(payload),
    retryLimit: 2,
  })
  return id ?? jobKeyFromPayload(payload)
}

export async function enqueueSyncFlightWithBoss(boss: PgBoss, flightNumber: string) {
  const payload: SyncFlightPayload = { flightNumber }
  return boss.send('sync_flight', payload, {
    singletonKey: jobKeyFromPayload(payload),
    retryLimit: 2,
  })
}
