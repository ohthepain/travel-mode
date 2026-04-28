import type { DBSchema, IDBPDatabase } from 'idb'
import { openDB } from 'idb'
import type { Country } from './countries-data'

const DB_NAME = 'travelmode-countries'
const DB_VER = 1
const STORE = 'catalog'
const CATALOG_KEY = 'default'

type CatalogRecord = {
  key: string
  storedAt: number
  countries: Country[]
}

interface CountriesDB extends DBSchema {
  catalog: { key: string; value: CatalogRecord }
}

let dbp: Promise<IDBPDatabase<CountriesDB>> | null = null

function openCountriesDb(): Promise<IDBPDatabase<CountriesDB>> | null {
  if (typeof indexedDB === 'undefined') return null
  dbp ??= openDB<CountriesDB>(DB_NAME, DB_VER, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    },
  })
  return dbp
}

export async function getCachedCountries(): Promise<Country[] | null> {
  const p = openCountriesDb()
  if (!p) return null
  try {
    const db = await p
    const rec = await db.get(STORE, CATALOG_KEY)
    if (!rec) return null
    return rec.countries
  } catch {
    return null
  }
}

export async function putCachedCountries(countries: Country[]): Promise<void> {
  const p = openCountriesDb()
  if (!p) return
  try {
    const db = await p
    await db.put(STORE, {
      key: CATALOG_KEY,
      storedAt: Date.now(),
      countries,
    })
  } catch {
    /* ignore quota / private mode */
  }
}
