import type { DBSchema, IDBPDatabase } from 'idb'
import { openDB } from 'idb'
import type { Airline } from './airlines-data'

const DB_NAME = 'travelmode-airlines'
const DB_VER = 2
const STORE = 'catalog'
const CATALOG_KEY = 'default'

type CatalogRecord = {
  key: string
  storedAt: number
  airlines: Airline[]
}

interface AirlinesDB extends DBSchema {
  catalog: { key: string; value: CatalogRecord }
}

let dbp: Promise<IDBPDatabase<AirlinesDB>> | null = null

function openAirlinesDb(): Promise<IDBPDatabase<AirlinesDB>> | null {
  if (typeof indexedDB === 'undefined') return null
  dbp ??= openDB<AirlinesDB>(DB_NAME, DB_VER, {
    upgrade(db, oldVersion) {
      if (oldVersion > 0 && oldVersion < 2 && db.objectStoreNames.contains(STORE)) {
        db.deleteObjectStore(STORE)
      }
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    },
  })
  return dbp
}

export async function getCachedAirlines(): Promise<Airline[] | null> {
  const p = openAirlinesDb()
  if (!p) return null
  try {
    const db = await p
    const rec = await db.get(STORE, CATALOG_KEY)
    if (!rec) return null
    return rec.airlines
  } catch {
    return null
  }
}

export async function putCachedAirlines(airlines: Airline[]): Promise<void> {
  const p = openAirlinesDb()
  if (!p) return
  try {
    const db = await p
    await db.put(STORE, {
      key: CATALOG_KEY,
      storedAt: Date.now(),
      airlines,
    })
  } catch {
    /* ignore quota / private mode */
  }
}
