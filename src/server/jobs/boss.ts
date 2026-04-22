import { PgBoss } from 'pg-boss'
import { handleSyncFlightBatches } from './sync-flight'

let boss: PgBoss | null = null
let startPromise: Promise<PgBoss> | null = null
let registered = false

function syncFlightLocalConcurrency(): number {
  const n = Number(process.env.FR24_PGBOSS_LOCAL_CONCURRENCY)
  if (Number.isFinite(n) && n >= 1 && n <= 8) return Math.floor(n)
  return 1
}

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss
  if (startPromise) return startPromise
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is required for background jobs (pg-boss)')
  }
  startPromise = (async () => {
    const b = new PgBoss({ connectionString: url })
    await b.start()
    if (!registered) {
      await b.createQueue('sync_flight')
      // pg-boss v10+: `work(name, options, handler)` — not (name, handler, options).
      await b.work('sync_flight', {
        localConcurrency: syncFlightLocalConcurrency(),
        batchSize: 1,
        pollingIntervalSeconds: 2,
      }, handleSyncFlightBatches)
      registered = true
    }
    boss = b
    return b
  })()
  return startPromise
}
