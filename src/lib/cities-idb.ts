import type { DBSchema, IDBPDatabase } from 'idb'
import { openDB } from 'idb'
import type { City } from './cities-data'

const DB_NAME = 'travelmode-cities'
const DB_VER = 1
const STORE = 'catalog'
const CATALOG_KEY = 'default'

type CatalogRecord = {
  key: string
  storedAt: number
  cities: City[]
}

interface CitiesDB extends DBSchema {
  catalog: { key: string; value: CatalogRecord }
}

let dbp: Promise<IDBPDatabase<CitiesDB>> | null = null

function openCitiesDb(): Promise<IDBPDatabase<CitiesDB>> | null {
  if (typeof indexedDB === 'undefined') return null
  dbp ??= openDB<CitiesDB>(DB_NAME, DB_VER, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    },
  })
  return dbp
}

/** `null` = nothing cached yet; `[]` = cached empty catalog. */
export async function getCachedCities(): Promise<City[] | null> {
  const p = openCitiesDb()
  if (!p) return null
  try {
    const db = await p
    const rec = await db.get(STORE, CATALOG_KEY)
    if (!rec) return null
    return rec.cities
  } catch {
    return null
  }
}

export async function putCachedCities(cities: City[]): Promise<void> {
  const p = openCitiesDb()
  if (!p) return
  try {
    const db = await p
    await db.put(STORE, {
      key: CATALOG_KEY,
      storedAt: Date.now(),
      cities,
    })
  } catch {
    /* ignore quota / private mode */
  }
}
