import { create } from 'zustand'
import type { Feature, FeatureCollection, LineString } from 'geojson'
import { pointAlong, addMinutes } from '../lib/interpolate'
import { putTile, saveFlightPack } from '../lib/tile-idb'
import { appMapTileUrlTemplate, countTilesBbox, tileRangeForBbox } from '../lib/tiles'

const Z_MIN = 3
const Z_MAX = 8

export type FlightState = {
  flightNumber: string
  travelDate: string
  line: Feature<LineString> | null
  /** Last tracks payload for IndexedDB (full FeatureCollection JSON) */
  lastGeojson: unknown | null
  bbox: [number, number, number, number] | null
  takeoff: Date
  takeoffOffsetMin: number
  /** Nudge map vs math position (meters, east/north) user correction */
  correctionEN: { e: number; n: number }
  tileProgress: { done: number; total: number } | null
  useOffline: boolean
  setFlight: (f: string, d?: string) => void
  setLineFromApi: (res: unknown) => void
  setTakeoff: (d: Date) => void
  setTakeoffOffset: (m: number) => void
  setCorrection: (e: number, n: number) => void
  setUseOffline: (o: boolean) => void
  loadPackFromIdb: () => Promise<void>
  downloadTiles: () => Promise<void>
  estimatedPosition: (now: Date) => [number, number] | null
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
  bbox: null,
  takeoff: new Date(),
  takeoffOffsetMin: 0,
  correctionEN: { e: 0, n: 0 },
  tileProgress: null,
  useOffline: false,
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
      bbox: isBbox(mb) ? mb : null,
      takeoff: t0 != null ? new Date(t0) : new Date(),
    })
  },
  setTakeoff: (d) => set({ takeoff: d }),
  setTakeoffOffset: (m) => set({ takeoffOffsetMin: m }),
  setCorrection: (e, n) => set({ correctionEN: { e, n } }),
  setUseOffline: (o) => set({ useOffline: o }),
  resetTileProgress: () => set({ tileProgress: null }),
  loadPackFromIdb: async () => {
    const { flightNumber, travelDate } = get()
    if (!flightNumber || !travelDate) return
    const { loadFlightPack } = await import('../lib/tile-idb')
    const p = await loadFlightPack(flightNumber, travelDate)
    if (p) {
      const g = p.geojson as FeatureCollection
      const line = firstLineString(g)
      const t0 = line ? firstTime(line) : null
      set({
        line,
        lastGeojson: p.geojson,
        bbox: p.bbox,
        takeoff: t0 != null ? new Date(t0) : new Date(),
      })
    }
  },
  downloadTiles: async () => {
    const { line, lastGeojson, flightNumber, travelDate, bbox } = get()
    let b = bbox
    if (!b && line) {
      const c = line.geometry.coordinates
      let w = 180,
        s = 85,
        e = -180,
        n = -85
      for (const [lon, lat] of c) {
        w = Math.min(w, lon)
        e = Math.max(e, lon)
        s = Math.min(s, lat)
        n = Math.max(n, lat)
      }
      b = [w, s, e, n]
    }
    if (!b) return
    const [w, s, e, n] = b
    const total = countTilesBbox(Z_MIN, Z_MAX, w, s, e, n)
    set({ tileProgress: { done: 0, total } })
    const base = appMapTileUrlTemplate()
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
          await putTile(t, buf)
        } else if (res.status === 503) {
          const body = await res.text()
          throw new Error(
            body || 'Tile proxy: set MAPTILER_API_KEY or VITE_MAPTILER_KEY in .env and restart the dev server.',
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
    let fc: FeatureCollection = { type: 'FeatureCollection', features: line ? [line] : [] }
    if (isFeatureCollection(lastGeojson)) {
      fc = lastGeojson
    }
    await saveFlightPack(flightNumber, travelDate, { geojson: fc, bbox: b })
  },
  estimatedPosition: (now) => {
    const { line, takeoff, takeoffOffsetMin, correctionEN } = get()
    if (!line?.geometry) return null
    const t0 = firstTime(line)
    const t1 = lastTime(line)
    if (t0 == null || t1 == null) {
      const p = pointAlong(line, 0.5)
      if (!p) return null
      return offsetMetersToLonLat(p, correctionEN)
    }
    const start = addMinutes(takeoff, takeoffOffsetMin).getTime()
    const duration = Math.max(1, t1 - t0)
    const prog = (now.getTime() - start) / duration
    const p = pointAlong(line, Math.min(1, Math.max(0, prog)))
    if (!p) return null
    return offsetMetersToLonLat(p, correctionEN)
  },
}))

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
