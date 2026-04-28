import type { DBSchema, IDBPDatabase } from 'idb'
import { openDB } from 'idb'
import type { Airport } from './airports-data'

const DB_NAME = 'travelmode-airports'
const DB_VER = 1
const STORE = 'catalog'
const CATALOG_KEY = 'default'

type CatalogRecord = {
  key: string
  storedAt: number
  airports: Airport[]
}

interface AirportsDB extends DBSchema {
  catalog: { key: string; value: CatalogRecord }
}

let dbp: Promise<IDBPDatabase<AirportsDB>> | null = null

function openAirportsDb(): Promise<IDBPDatabase<AirportsDB>> | null {
  if (typeof indexedDB === 'undefined') return null
  dbp ??= openDB<AirportsDB>(DB_NAME, DB_VER, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    },
  })
  return dbp
}

/** `null` = nothing cached yet; `[]` = cached empty catalog. */
export async function getCachedAirports(): Promise<Airport[] | null> {
  const p = openAirportsDb()
  if (!p) return null
  try {
    const db = await p
    const rec = await db.get(STORE, CATALOG_KEY)
    if (!rec) return null
    return rec.airports
  } catch {
    return null
  }
}

export async function putCachedAirports(airports: Airport[]): Promise<void> {
  const p = openAirportsDb()
  if (!p) return
  try {
    const db = await p
    await db.put(STORE, {
      key: CATALOG_KEY,
      storedAt: Date.now(),
      airports,
    })
  } catch {
    /* ignore quota / private mode */
  }
}
