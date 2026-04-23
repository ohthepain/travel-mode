/** Web Mercator XYZ tile indices for a lon/lat bbox at integer zoom (MapLibre / OSM). */

function lonLatToTile(lon: number, lat: number, z: number) {
  const n = 2.0 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  )
  return { x, y: Math.min(2 ** z - 1, Math.max(0, y)) }
}

export function tileRangeForBbox(
  z: number,
  west: number,
  south: number,
  east: number,
  north: number,
): { x: number; y: number; z: number }[] {
  const a = lonLatToTile(west, north, z)
  const b = lonLatToTile(east, south, z)
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  const out: { x: number; y: number; z: number }[] = []
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      out.push({ z, x, y })
    }
  }
  return out
}

export function countTilesBbox(
  zMin: number,
  zMax: number,
  west: number,
  south: number,
  east: number,
  north: number,
) {
  let n = 0
  for (let z = zMin; z <= zMax; z++)
    n += tileRangeForBbox(z, west, south, east, north).length
  return n
}

/** Direct MapTiler URL (for server-to-server fetches; prefer {@link appMapTileUrlTemplate} in the browser). */
export const mapTilerRasterUrl = (key: string) =>
  `https://api.maptiler.com/maps/topo-v2/256/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`

/**
 * Same-origin tile URL so MapLibre / fetch do not call MapTiler directly (avoids 403 for referrer-locked keys).
 * Placeholders: `{z}` `{x}` `{y}`.
 */
export function appMapTileUrlTemplate(): string {
  // Do not use `new URL(...).href` — the URL API encodes `{` and `}` to %7B/%7D, and
  // MapLibre matches literal `{z}` / `{x}` / `{y}` in the string when substituting tiles.
  const base =
    typeof window === 'undefined'
      ? 'http://localhost:3020'
      : window.location.origin
  return `${base}/api/map-tiles/{z}/{x}/{y}.png`
}
