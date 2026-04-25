import { along, bearing, length, lineString } from '@turf/turf'
import type { Feature, LineString, Position } from 'geojson'

/** Drop hole / null / non-finite entries so Turf's `distance` / `along` never see invalid positions. */
function lineStringValidCoords(coords: Position[]): [number, number][] {
  const out: [number, number][] = []
  for (const c of coords) {
    if (!c || c.length < 2) continue
    const a = c[0]
    const b = c[1]
    if (
      typeof a === 'number' &&
      typeof b === 'number' &&
      Number.isFinite(a) &&
      Number.isFinite(b)
    ) {
      out.push([a, b])
    }
  }
  return out
}

/** 0..1 along the first LineString in the feature. */
export function pointAlong(
  lineFeat: Feature<LineString> | null,
  t01: number,
): [number, number] | null {
  if (!lineFeat) return null
  const coords = lineStringValidCoords(lineFeat.geometry.coordinates)
  if (!coords.length) return null
  const n = coords.length
  if (n < 2) {
    const c0 = coords[0]
    return [c0[0], c0[1]]
  }
  const t = Math.min(1, Math.max(0, t01))
  const ls = lineString(coords)
  const L = length(ls, { units: 'kilometers' })
  if (L <= 0) {
    const c0 = coords[0]
    return [c0[0], c0[1]]
  }
  const dist = t * L
  const p = along(ls, dist, { units: 'kilometers' })
  const c = p.geometry.coordinates
  return [c[0], c[1]]
}

/**
 * Geographic bearing along the line at normalized distance 0..1 (Turf: degrees clockwise from north).
 * For short segments, uses a small step along the line; at endpoints, uses the end segment.
 */
export function bearingAlongLine(
  lineFeat: Feature<LineString> | null,
  t01: number,
): number | null {
  if (!lineFeat) return null
  const coords = lineStringValidCoords(lineFeat.geometry.coordinates)
  if (coords.length < 2) return null
  const ls = lineString(coords)
  const L = length(ls, { units: 'kilometers' })
  if (L <= 0) return null
  const t = Math.min(1, Math.max(0, t01))
  const eps = Math.max(L * 0.0005, 0.01)
  // Turf's `along` with negative `distance` uses bearing(coords[0], coords[-1]) and throws
  // "coord is required" — so keep d0, d1 in [0, L] (t*L < eps is common right after "Take off").
  let d0: number
  let d1: number
  if (t <= 0) {
    d0 = 0
    d1 = Math.min(L, eps * 2)
  } else if (t >= 1) {
    d0 = Math.max(0, L - eps * 2)
    d1 = L
  } else {
    d0 = Math.max(0, t * L - eps)
    d1 = Math.min(L, t * L + eps)
  }
  if (d1 - d0 < 1e-9) {
    const a = coords[0]
    const b = coords[1]
    return bearing(a, b)
  }
  const p0 = along(ls, d0, { units: 'kilometers' })
  const p1 = along(ls, d1, { units: 'kilometers' })
  return bearing(p0.geometry.coordinates, p1.geometry.coordinates)
}

/** Progress 0..1 from timestamps (ms). */
export function timeProgress(tMs: number, start: number, end: number) {
  if (end <= start) return 0
  return Math.min(1, Math.max(0, (tMs - start) / (end - start)))
}

export function addMinutes(d: Date, m: number) {
  return new Date(d.getTime() + m * 60_000)
}
