import { along, length, lineString } from '@turf/turf'
import type { Feature, LineString } from 'geojson'

/** 0..1 along the first LineString in the feature. */
export function pointAlong(
  lineFeat: Feature<LineString> | null,
  t01: number,
): [number, number] | null {
  if (!lineFeat) return null
  const coords = lineFeat.geometry.coordinates
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

/** Progress 0..1 from timestamps (ms). */
export function timeProgress(
  tMs: number,
  start: number,
  end: number,
) {
  if (end <= start) return 0
  return Math.min(1, Math.max(0, (tMs - start) / (end - start)))
}

export function addMinutes(d: Date, m: number) {
  return new Date(d.getTime() + m * 60_000)
}
