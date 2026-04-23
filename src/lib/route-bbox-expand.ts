import { bearing, destination } from '@turf/turf'
import type { Feature, LineString } from 'geojson'
import { bboxFromLineString } from './line-bbox'

/** Lon/lat bbox [west, south, east, north] */
export type LonLatBBox = [number, number, number, number]

/**
 * Past the last ADS-B point along the final segment — tracks often stop short of the destination.
 * ~520 km covers most European “lost coverage before landing” gaps.
 */
const KM_PAST_TRACK_END = 520
/** Before the first point for departure / climb tiles. */
const KM_BEFORE_TRACK_START = 140

export function unionLonLatBboxes(
  a: LonLatBBox | null | undefined,
  b: LonLatBBox | null | undefined,
): LonLatBBox | null {
  if (!a) return b ?? null
  if (!b) return a
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ]
}

function includePoint(b: LonLatBBox, lon: number, lat: number): LonLatBBox {
  return [
    Math.min(b[0], lon),
    Math.min(b[1], lat),
    Math.max(b[2], lon),
    Math.max(b[3], lat),
  ]
}

/** Expand bbox so tiles cover points beyond incomplete track ends (shared server + client). */
export function expandBboxPastTrackCoords(coords: [number, number][], bbox: LonLatBBox): LonLatBBox {
  if (coords.length < 2) return bbox
  let b = bbox
  const [lon0, lat0] = coords[0]
  const [lon1, lat1] = coords[1]
  const br0 = bearing([lon0, lat0], [lon1, lat1])
  const back = ((br0 + 180 + 540) % 360) - 180
  const pStart = destination([lon0, lat0], KM_BEFORE_TRACK_START, back, { units: 'kilometers' })
  const [slon, slat] = pStart.geometry.coordinates as [number, number]
  b = includePoint(b, slon, slat)

  const L = coords.length
  const [lona, lata] = coords[L - 2]
  const [lonb, latb] = coords[L - 1]
  const br1 = bearing([lona, lata], [lonb, latb])
  const pEnd = destination([lonb, latb], KM_PAST_TRACK_END, br1, { units: 'kilometers' })
  const [elon, elat] = pEnd.geometry.coordinates as [number, number]
  b = includePoint(b, elon, elat)
  return b
}

export function expandBboxPastTrackEnds(line: Feature<LineString> | null, bbox: LonLatBBox): LonLatBBox {
  if (!line?.geometry.coordinates.length) return bbox
  return expandBboxPastTrackCoords(line.geometry.coordinates as [number, number][], bbox)
}

/** Union API / pack bbox with line bounds, then extend past track ends for map tiles and offline packs. */
export function effectiveFlightMapBbox(
  line: Feature<LineString> | null,
  metaBbox: LonLatBBox | null,
): LonLatBBox | null {
  const lb = bboxFromLineString(line)
  const base = unionLonLatBboxes(metaBbox, lb)
  if (!base) return null
  return expandBboxPastTrackEnds(line, base)
}
