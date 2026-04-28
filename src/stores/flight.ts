import { create } from 'zustand'
import type { Feature, FeatureCollection, LineString } from 'geojson'
import { pointAlong, addMinutes, bearingAlongLine } from '../lib/interpolate'
import {
  getGeoFeaturesForTiles,
  loadFlightPack,
  putGeoFeatureTile,
  putTile,
  saveFlightPack,
} from '../lib/tile-idb'
import { MapStyle, type RasterMapId, isAllowedRasterMapId } from '../lib/map-styles'
import { appMapTileUrlTemplate, countTilesBbox, tileRangeForBbox } from '../lib/tiles'
import { effectiveFlightMapBbox } from '../lib/route-bbox-expand'
import {
  appGeoFeatureTileUrl,
  degreeTilesForBbox,
  degreeTilesForLineString,
  isGeoFeatureCollection,
  type DegreeTile,
  type GeoFeatureCollection,
  type GeoFeatureResolution,
} from '../lib/geo-feature-tiles'

const Z_MIN = 3
const Z_MAX = 8

export type FlightState = {
  flightNumber: string
  travelDate: string
  line: Feature<LineString> | null
  /** Last tracks payload for IndexedDB (full FeatureCollection JSON) */
  lastGeojson: unknown | null
  /** Full last `/tracks` response or offline pack snapshot (dev inspect). */
  lastTracksPayload: unknown | null
  geoFeatures: GeoFeatureCollection | null
  bbox: [number, number, number, number] | null
  takeoff: Date
  takeoffOffsetMin: number
  /** Nudge map vs math position (meters, east/north) user correction */
  correctionEN: { e: number; n: number }
  tileProgress: { done: number; total: number } | null
  useOffline: boolean
  /** MapTiler basemap `mapId` for online tiles and the next / current offline download. */
  rasterMapId: RasterMapId
  setRasterMapId: (id: RasterMapId) => void
  /** When true (home), page chrome uses full width for the map. */
  mapMode: boolean
  setMapMode: (v: boolean) => void
  setFlight: (f: string, d?: string) => void
  setLineFromApi: (res: unknown) => void
  setTakeoff: (d: Date) => void
  setTakeoffOffset: (m: number) => void
  setCorrection: (e: number, n: number) => void
  setUseOffline: (o: boolean) => void
  loadPackFromIdb: () => Promise<void>
  /** Clear line/bbox from a previous flight when the route (flight+date) changes; IDB can refill. */
  clearTrackData: () => void
  downloadTiles: () => Promise<void>
  loadGeoFeaturesFromIdb: () => Promise<void>
  estimatedPosition: (now: Date) => [number, number] | null
  /** Progress 0..1 along the track for elapsed ms since departure anchor (same basis as `estimatedPosition`). */
  positionAtElapsedMs: (elapsedMs: number) => [number, number] | null
  resetTileProgress: () => void
}

function firstLineString(fc: unknown): Feature<LineString> | null {
  if (!fc || typeof fc !== 'object') return null
  const f = fc as { type?: string; features?: unknown[] }
  if (f.type !== 'FeatureCollection' || !Array.isArray(f.features)) return null
  for (const ft of f.features) {
    if (!ft || typeof ft !== 'object') continue
    const g = ft as { type?: string; geometry?: { type?: string } }
    if (g.type === 'Feature' && g.geometry && g.geometry.type === 'LineString') {
      return ft as Feature<LineString>
    }
  }
  return null
}

export const useFlightStore = create<FlightState>((set, get) => ({
  flightNumber: '',
  travelDate: '',
  line: null,
  lastGeojson: null,
  lastTracksPayload: null,
  geoFeatures: null,
  bbox: null,
  takeoff: new Date(),
  takeoffOffsetMin: 0,
  correctionEN: { e: 0, n: 0 },
  tileProgress: null,
  useOffline: false,
  rasterMapId: MapStyle.Base,
  setRasterMapId: (id) => set({ rasterMapId: id }),
  mapMode: false,
  setMapMode: (v) => set({ mapMode: v }),
  setFlight: (fn, d) =>
    set({ flightNumber: fn, travelDate: d ?? 'latest' }),
  setLineFromApi: (data) => {
    const o = data as { features?: unknown[]; meta?: { bbox?: [number, number, number, number] } }
    const rawFeats = o.features
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: Array.isArray(rawFeats) ? (rawFeats as Feature<LineString>[]) : [],
    }
    const line = firstLineString(fc)
    const t0 = line ? firstTime(line) : null
    const mb = o.meta?.bbox
    set({
      line,
      lastGeojson: fc,
      lastTracksPayload: data,
      geoFeatures: null,
      bbox: isBbox(mb) ? mb : null,
      takeoff: t0 != null ? new Date(t0) : new Date(),
    })
  },
  setTakeoff: (d) => set({ takeoff: d }),
  setTakeoffOffset: (m) => set({ takeoffOffsetMin: m }),
  setCorrection: (e, n) => set({ correctionEN: { e, n } }),
  setUseOffline: (o) => set({ useOffline: o }),
  resetTileProgress: () => set({ tileProgress: null }),
  clearTrackData: () =>
    set({ line: null, lastGeojson: null, lastTracksPayload: null, geoFeatures: null, bbox: null }),
  loadPackFromIdb: async () => {
    const { flightNumber, travelDate } = get()
    if (!flightNumber || !travelDate) {
      set({ useOffline: false })
      return
    }
    const fn0 = flightNumber
    const td0 = travelDate
    const p = await loadFlightPack(flightNumber, travelDate)
    const cur = get()
    if (cur.flightNumber !== fn0 || cur.travelDate !== td0) return
    if (p) {
      const g = p.geojson as FeatureCollection
      const line = firstLineString(g)
      const t0 = line ? firstTime(line) : null
      const packMap =
        p.rasterMapId && isAllowedRasterMapId(p.rasterMapId) ? p.rasterMapId : MapStyle.Base
      set({
        line,
        lastGeojson: p.geojson,
        lastTracksPayload: { _source: 'indexeddb' as const, geojson: p.geojson, bbox: p.bbox },
        geoFeatures: null,
        bbox: p.bbox,
        takeoff: t0 != null ? new Date(t0) : new Date(),
        useOffline: true,
        rasterMapId: packMap,
      })
    } else {
      set({ useOffline: false })
    }
  },
  loadGeoFeaturesFromIdb: async () => {
    const { line, bbox } = get()
    const b = effectiveFlightMapBbox(line, bbox)
    if (!b) {
      set({ geoFeatures: null })
      return
    }
    const plan = geoFeatureTilePlan(line, b)
    const geoFeatures = await getGeoFeaturesForTiles(plan)
    set({ geoFeatures })
  },
  downloadTiles: async () => {
    const { line, lastGeojson, flightNumber, travelDate, bbox, rasterMapId: rid0 } = get()
    const rasterMapId = rid0
    const b = effectiveFlightMapBbox(line, bbox)
    if (!b) {
      throw new Error(
        'Load tracks first so we know the map area, then try Save for offline again.',
      )
    }
    const [w, s, e, n] = b
    const geoPlan = geoFeatureTilePlan(line, b)
    const total = countTilesBbox(Z_MIN, Z_MAX, w, s, e, n) + geoPlan.length
    set({ tileProgress: { done: 0, total } })
    try {
      const base = appMapTileUrlTemplate(rasterMapId)
      let done = 0
      for (let z = Z_MIN; z <= Z_MAX; z++) {
        for (const t of tileRangeForBbox(z, w, s, e, n)) {
          const u = base
            .replace('{z}', String(t.z))
            .replace('{x}', String(t.x))
            .replace('{y}', String(t.y))
          const res = await fetch(u)
          if (res.ok) {
            const buf = await res.arrayBuffer()
            await putTile(t, buf, rasterMapId)
          } else if (res.status === 503) {
            const body = await res.text()
            throw new Error(
              body || 'Tile proxy: set VITE_MAPTILER_API_KEY in .env and restart the dev server.',
            )
          } else if (res.status === 502) {
            const body = await res.text()
            throw new Error(
              body || 'MapTiler returned an error. Check the API key and MapTiler account.',
            )
          }
          done++
          set({ tileProgress: { done, total } })
        }
      }
      for (const { tile, resolution } of geoPlan) {
        // 404 = no file for that degree cell in the bucket; normal outside built coverage (see docs/offline-maps).
        // DevTools may still show "404 (Not Found)" for these GETs with a line pointer here—that is the fetch initiator, not a thrown app error; we do not throw on 404.
        const res = await fetch(appGeoFeatureTileUrl(tile, resolution))
        if (res.ok) {
          const geojson = await res.json()
          if (isGeoFeatureCollection(geojson)) {
            await putGeoFeatureTile(tile, resolution, geojson)
          }
        } else if (res.status === 503) {
          const body = await res.text()
          throw new Error(body || 'Geo feature proxy: set S3_BUCKET_GEOJSON in .env and restart the dev server.')
        } else if (res.status !== 404) {
          console.warn('[geo-features] ignored failed tile', res.status, tile.prefix, resolution)
        }
        done++
        set({ tileProgress: { done, total } })
      }
      let fc: FeatureCollection = { type: 'FeatureCollection', features: line ? [line] : [] }
      if (isFeatureCollection(lastGeojson)) {
        fc = lastGeojson
      }
      await saveFlightPack(flightNumber, travelDate, { geojson: fc, bbox: b, rasterMapId })
      set({ geoFeatures: await getGeoFeaturesForTiles(geoPlan) })
      set({ useOffline: true })
    } finally {
      set({ tileProgress: null })
    }
  },
  positionAtElapsedMs: (elapsedMs) => {
    const { line, correctionEN } = get()
    if (!line?.geometry) return null
    const t0 = firstTime(line)
    const t1 = lastTime(line)
    if (t0 == null || t1 == null) {
      const p = pointAlong(line, 0.5)
      if (!p) return null
      return offsetMetersToLonLat(p, correctionEN)
    }
    const duration = Math.max(1, t1 - t0)
    const prog = elapsedMs / duration
    const p = pointAlong(line, Math.min(1, Math.max(0, prog)))
    if (!p) return null
    return offsetMetersToLonLat(p, correctionEN)
  },
  estimatedPosition: (now) => {
    const { takeoff, takeoffOffsetMin } = get()
    const start = addMinutes(takeoff, takeoffOffsetMin).getTime()
    return get().positionAtElapsedMs(now.getTime() - start)
  },
}))

function geoFeatureTilePlan(
  line: Feature<LineString> | null,
  bbox: [number, number, number, number],
): { tile: DegreeTile; resolution: GeoFeatureResolution }[] {
  const highres = new Map(degreeTilesForLineString(line).map((tile) => [tile.tileId, tile]))
  const all = degreeTilesForBbox(bbox)

  return all.map((tile) => ({
    tile,
    resolution: highres.has(tile.tileId) ? 'highres' : 'lowres',
  }))
}

function isBbox(
  v: unknown,
): v is [number, number, number, number] {
  if (!Array.isArray(v) || v.length !== 4) return false
  return v.every((n) => typeof n === 'number' && !Number.isNaN(n))
}

function isFeatureCollection(x: unknown): x is FeatureCollection {
  if (!x || typeof x !== 'object') return false
  const o = x as { type?: string; features?: unknown }
  return o.type === 'FeatureCollection' && Array.isArray(o.features)
}

/** Track span in ms for playback scrubber; null if line missing or timestamps absent. */
export function flightTrackDurationMs(line: Feature<LineString> | null): number | null {
  if (!line) return null
  const t0 = firstTime(line)
  const t1 = lastTime(line)
  if (t0 == null || t1 == null) return null
  return Math.max(1, t1 - t0)
}

/**
 * 0..1 along the line for the same time basis as `positionAtElapsedMs` (midpoint if timestamps missing).
 */
export function flightPlaybackProgress01(
  line: Feature<LineString> | null,
  elapsedMs: number,
): number {
  if (!line?.geometry) return 0
  const t0 = firstTime(line)
  const t1 = lastTime(line)
  if (t0 == null || t1 == null) {
    return 0.5
  }
  const duration = Math.max(1, t1 - t0)
  return Math.min(1, Math.max(0, elapsedMs / duration))
}

/** Turf bearing (° clockwise from north) along the track at playback time, or null if no direction. */
export function trackBearingTurf(
  line: Feature<LineString> | null,
  elapsedMs: number,
): number | null {
  if (!line) return null
  return bearingAlongLine(line, flightPlaybackProgress01(line, elapsedMs))
}

function firstTime(f: Feature<LineString>) {
  const t = f.properties
  if (t && typeof t === 'object' && 'firstTimestampMs' in t) {
    const n = (t as { firstTimestampMs: number | bigint }).firstTimestampMs
    if (typeof n === 'number') return n
    if (typeof n === 'bigint') return Number(n)
  }
  return null
}

function lastTime(f: Feature<LineString>) {
  const t = f.properties
  if (t && typeof t === 'object' && 'lastTimestampMs' in t) {
    const n = (t as { lastTimestampMs: number | bigint }).lastTimestampMs
    if (typeof n === 'number') return n
    if (typeof n === 'bigint') return Number(n)
  }
  return null
}

/** Rough e/n offset in WGS84 degrees for small shifts */
function offsetMetersToLonLat(
  p: [number, number],
  c: { e: number; n: number },
): [number, number] {
  const lat = (p[1] * Math.PI) / 180
  const dlat = c.n / 111_111
  const dlon = c.e / (111_111 * Math.cos(lat))
  return [p[0] + dlon, p[1] + dlat]
}
