import type { DBSchema, IDBPDatabase } from 'idb'
import { openDB } from 'idb'
import {
  degreeTileForLonLat,
  isGeoFeatureCollection,
  mergeGeoFeatureCollections,
  type DegreeTile,
  type GeoFeatureCollection,
  type GeoFeatureResolution,
} from './geo-feature-tiles'

const DB = 'travelmode-tiles'
const VER = 2
const TILE_STORE = 'tiles'
const PACK_STORE = 'packs'
const GEO_FEATURE_STORE = 'geoFeatureTiles'

type TileKey = { z: number; x: number; y: number }

type TileRec = { id: string; z: number; x: number; y: number; data: ArrayBuffer; storedAt: number }

type GeoFeatureTileRec = {
  id: string
  resolution: GeoFeatureResolution
  latTile: number
  lonTile: number
  tileId: string
  prefix: string
  geojson: GeoFeatureCollection
  storedAt: number
}

export type PackRec = {
  id: string
  flightNumber: string
  travelDate: string
  geojson: unknown
  bbox: [number, number, number, number] | null
  savedAt: number
}

interface TravelmodeDB extends DBSchema {
  [TILE_STORE]: { key: string; value: TileRec }
  [PACK_STORE]: { key: string; value: PackRec }
  [GEO_FEATURE_STORE]: { key: string; value: GeoFeatureTileRec }
}

function tkey(t: TileKey) {
  return `${t.z}/${t.x}/${t.y}`
}
function packId(flightNumber: string, travelDate: string) {
  return `${flightNumber.toUpperCase()}:${travelDate}`
}
function geoFeatureTileId(resolution: GeoFeatureResolution, tile: Pick<DegreeTile, 'tileId'>) {
  return `${resolution}:${tile.tileId}`
}

let dbp: Promise<IDBPDatabase<TravelmodeDB>> | null = null

function getDb() {
  dbp ??= openDB<TravelmodeDB>(DB, VER, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(TILE_STORE)) {
        db.createObjectStore(TILE_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(PACK_STORE)) {
        db.createObjectStore(PACK_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(GEO_FEATURE_STORE)) {
        db.createObjectStore(GEO_FEATURE_STORE, { keyPath: 'id' })
      }
    },
  })
  return dbp
}

export async function putTile(t: TileKey, data: ArrayBuffer) {
  const db = await getDb()
  const id = tkey(t)
  const rec: TileRec = { id, z: t.z, x: t.x, y: t.y, data, storedAt: Date.now() }
  await db.put(TILE_STORE, rec)
}

export async function getTileData(t: TileKey): Promise<ArrayBuffer | undefined> {
  const db = await getDb()
  const r = await db.get(TILE_STORE, tkey(t))
  return r?.data
}

export async function putGeoFeatureTile(
  tile: DegreeTile,
  resolution: GeoFeatureResolution,
  geojson: GeoFeatureCollection,
) {
  const db = await getDb()
  const rec: GeoFeatureTileRec = {
    id: geoFeatureTileId(resolution, tile),
    resolution,
    latTile: tile.latTile,
    lonTile: tile.lonTile,
    tileId: tile.tileId,
    prefix: tile.prefix,
    geojson,
    storedAt: Date.now(),
  }
  await db.put(GEO_FEATURE_STORE, rec)
}

export async function getGeoFeatureTile(
  tile: DegreeTile,
  resolution: GeoFeatureResolution,
): Promise<GeoFeatureCollection | undefined> {
  const db = await getDb()
  const rec = await db.get(GEO_FEATURE_STORE, geoFeatureTileId(resolution, tile))
  return rec?.geojson
}

export async function getGeoFeatureTileForLonLat(
  lon: number,
  lat: number,
  resolution: GeoFeatureResolution,
): Promise<GeoFeatureCollection | undefined> {
  return getGeoFeatureTile(degreeTileForLonLat(lon, lat), resolution)
}

export async function getGeoFeaturesForTiles(
  tiles: { tile: DegreeTile; resolution: GeoFeatureResolution }[],
): Promise<GeoFeatureCollection> {
  const db = await getDb()
  const collections: GeoFeatureCollection[] = []

  for (const { tile, resolution } of tiles) {
    const rec = await db.get(GEO_FEATURE_STORE, geoFeatureTileId(resolution, tile))
    if (rec && isGeoFeatureCollection(rec.geojson)) collections.push(rec.geojson)
  }

  return mergeGeoFeatureCollections(collections)
}

export async function saveFlightPack(
  flightNumber: string,
  travelDate: string,
  payload: { geojson: unknown; bbox: [number, number, number, number] | null },
) {
  const db = await getDb()
  const id = packId(flightNumber, travelDate)
  const rec: PackRec = {
    id,
    flightNumber: flightNumber.toUpperCase(),
    travelDate,
    geojson: payload.geojson,
    bbox: payload.bbox,
    savedAt: Date.now(),
  }
  await db.put(PACK_STORE, rec)
}

export async function loadFlightPack(
  flightNumber: string,
  travelDate: string,
): Promise<PackRec | undefined> {
  const db = await getDb()
  return db.get(PACK_STORE, packId(flightNumber, travelDate))
}

export async function hasFlightPack(
  flightNumber: string,
  travelDate: string,
): Promise<boolean> {
  const p = await loadFlightPack(flightNumber, travelDate)
  return p != null
}
