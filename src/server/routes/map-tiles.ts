import 'dotenv/config'
import { Hono } from 'hono'
import { mapTilerRasterUrl } from '../../lib/tiles'

/**
 * Browser → same-origin → MapTiler, with the key on the server.
 * Avoids MapTiler 403s when a key is restricted to server/referrer, or when workers omit Referer.
 */
export const mapTileRoutes = new Hono()

function parseTileParam(seg: string): number {
  const s = seg.replace(/\.(png|jpg|jpeg|webp|gif)$/i, '')
  return Number(s)
}

mapTileRoutes.get('/:z/:x/:y', async (c) => {
  // Last segment is e.g. `1.png` — must not use `Number` directly (NaN → 400).
  const z = parseTileParam(c.req.param('z'))
  const x = parseTileParam(c.req.param('x'))
  const y = parseTileParam(c.req.param('y'))
  if (!Number.isInteger(z) || z < 0 || z > 22) {
    return c.text('Invalid z', 400)
  }
  const n = 2 ** z
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) {
    return c.text('Invalid tile', 400)
  }
  const key = process.env.MAPTILER_API_KEY?.trim() || process.env.VITE_MAPTILER_KEY?.trim()
  if (!key) {
    return c.text('Set MAPTILER_API_KEY or VITE_MAPTILER_KEY in .env', 503)
  }
  const upstream = mapTilerRasterUrl(key)
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
  const u = new URL(upstream)
  const r = await fetch(u, {
    headers: {
      Accept: 'image/png,image/*,*/*',
      'User-Agent': 'travelmode/1.0 (tile proxy)',
    },
  })
  if (!r.ok) {
    console.warn('[map-tiles] MapTiler', r.status, u.pathname)
    return c.text('Upstream error', 502)
  }
  const buf = await r.arrayBuffer()
  const ct = r.headers.get('content-type') ?? 'image/png'
  c.header('Cache-Control', 'public, max-age=86400, s-maxage=86400')
  c.header('Content-Type', ct)
  return c.body(buf)
})
