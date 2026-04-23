import type { Map } from 'maplibre-gl'

/** [west, south, east, north] */
export type LonLatBBox = readonly [number, number, number, number]

const EPS = 1e-5

/** True if the current map viewport is entirely inside the lon/lat bbox (same tolerance as {@link minZoomToContainViewportInBBox}). */
export function viewportFitsInBBox(map: Map, bbox: LonLatBBox): boolean {
  const [west, south, east, north] = bbox
  const b = map.getBounds()
  return (
    b.getWest() >= west - EPS &&
    b.getEast() <= east + EPS &&
    b.getSouth() >= south - EPS &&
    b.getNorth() <= north + EPS
  )
}

/** Shift map center so {@link Map#getBounds} is inside `bbox` at the current zoom. */
export function clampCenterToContainBBox(
  map: Map,
  lng: number,
  lat: number,
  bbox: LonLatBBox,
): [number, number] {
  const [west, south, east, north] = bbox
  let L = lng
  let φ = lat
  for (let i = 0; i < 6; i++) {
    map.jumpTo({ center: [L, φ] })
    const b = map.getBounds()
    const loLng = west - b.getWest()
    const hiLng = east - b.getEast()
    let dLng: number
    if (loLng <= hiLng) dLng = (loLng + hiLng) / 2
    else dLng = ((west + east) / 2 - L) * 0.5

    const loLat = south - b.getSouth()
    const hiLat = north - b.getNorth()
    let dLat: number
    if (loLat <= hiLat) dLat = (loLat + hiLat) / 2
    else dLat = ((south + north) / 2 - φ) * 0.5

    if (Math.abs(dLng) < 1e-10 && Math.abs(dLat) < 1e-10) break
    L += dLng
    φ += dLat
  }
  return [L, φ]
}

/**
 * Most zoomed-out level (smallest numeric zoom) allowed so that at bbox center the viewport fits in `bbox`.
 */
export function minZoomToContainViewportInBBox(map: Map, bbox: LonLatBBox): number {
  const [west, south, east, north] = bbox
  const cx = (west + east) / 2
  const cy = (south + north) / 2

  function fits(z: number): boolean {
    map.jumpTo({ center: [cx, cy], zoom: z })
    const b = map.getBounds()
    return (
      b.getWest() >= west - EPS &&
      b.getEast() <= east + EPS &&
      b.getSouth() >= south - EPS &&
      b.getNorth() <= north + EPS
    )
  }

  let lo = map.getMinZoom()
  let hi = map.getMaxZoom()
  if (!fits(hi)) return hi
  for (let k = 0; k < 40 && hi - lo > 1e-4; k++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) hi = mid
    else lo = mid
  }
  map.jumpTo({ center: [cx, cy], zoom: hi })
  return hi
}
