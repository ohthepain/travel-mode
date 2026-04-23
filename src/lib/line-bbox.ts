import type { Feature, LineString } from 'geojson'

/** Lon/lat bounding box [west, south, east, north] from a LineString, or null if empty. */
export function bboxFromLineString(line: Feature<LineString> | null): [
  number,
  number,
  number,
  number,
] | null {
  if (!line) return null
  const c = line.geometry.coordinates
  if (!c.length) return null
  let w = 180,
    s = 85,
    e = -180,
    n = -85
  for (const pt of c) {
    const lon = pt[0]
    const lat = pt[1]
    w = Math.min(w, lon)
    e = Math.max(e, lon)
    s = Math.min(s, lat)
    n = Math.max(n, lat)
  }
  return [w, s, e, n]
}
