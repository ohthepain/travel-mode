import type { PgBoss } from 'pg-boss'
import { prisma } from '../db'
import { getFlightSummaryLookbackDays } from '../fr24/client'
import { getBoss } from './boss'
import type { SyncFlightPayload } from './sync-payload'
import { flightNumbersFromPayload } from './sync-payload'

/** Singleton key used by {@link enqueueSyncFlight} for a single flight number. */
export function syncFlightSingletonKey(flightNumber: string) {
  const fn = String(flightNumber).replace(/\s+/g, '').toUpperCase()
  return `sync_flight:${fn}`
}

/** Sync indicator for UI: track data present (see {@link flightAlreadySynced}) and whether a worker is actively running sync. */
export async function flightSyncUiState(flightNumber: string): Promise<{
  synced: boolean
  jobActive: boolean
}> {
  const fn = String(flightNumber).replace(/\s+/g, '').toUpperCase()
  if (!fn) return { synced: false, jobActive: false }
  const key = syncFlightSingletonKey(fn)
  try {
    const boss = await getBoss()
    const [synced, jobs] = await Promise.all([
      flightAlreadySynced(fn),
      boss.findJobs<SyncFlightPayload>('sync_flight', { key }),
    ])
    const jobActive = jobs.some((j) => j.state === 'active')
    return { synced, jobActive }
  } catch {
    return { synced: false, jobActive: false }
  }
}

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
