import 'dotenv/config'
import { Hono } from 'hono'
import { getMapTilerApiKeyFromEnv } from '../../lib/server-maptiler-key'
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
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= n ||
    y >= n
  ) {
    return c.text('Invalid tile', 400)
  }

  const key = getMapTilerApiKeyFromEnv()
  if (!key) {
    return c.text(
      'Set VITE_MAPTILER_API_KEY (or MAPTILER_API_KEY / VITE_MAPTILER_KEY) in .env',
      503,
    )
  }
  const mapQ = c.req.query('map') || undefined
  const upstream = mapTilerRasterUrl(key, mapQ)
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
  const u = new URL(upstream)
  // Do not send a custom User-Agent: MapTiler/CDN may return 403 for non-browser UAs while the same URL works in curl.
  const r = await fetch(u, {
    headers: {
      Accept: 'image/png,image/*,*/*',
    },
  })
  if (!r.ok) {
    const ct = (r.headers.get('content-type') ?? '').toLowerCase()
    if (ct.startsWith('image/')) {
      // MapTiler can return 403/401 with a PNG body; do not read as text.
      console.warn(
        '[map-tiles] MapTiler',
        r.status,
        u.pathname,
        '(image response body)',
      )
    } else {
      let errSnippet = ''
      try {
        errSnippet = (await r.clone().text()).slice(0, 200)
      } catch {
        /* ignore */
      }
      console.warn('[map-tiles] MapTiler', r.status, u.pathname, errSnippet)
    }
    c.header('X-Upstream-Status', String(r.status))
    if (r.status === 403) {
      return c.text(
        'MapTiler 403: your key is not allowed to load this map. In MapTiler Cloud (account/keys), ensure the key belongs to the same account as the map and is not blocked. If the key has “allowed HTTP origins” (referrer) set, note: this app’s tile proxy runs on the server with no Origin header, so those rules often block it—use a separate key with no origin restriction for VITE_MAPTILER_API_KEY, or switch the basemap to Base until the key is fixed.',
        502,
      )
    }
    return c.text('Upstream error', 502)
  }
  const buf = await r.arrayBuffer()
  const ct = r.headers.get('content-type') ?? 'image/png'
  c.header('Cache-Control', 'public, max-age=86400, s-maxage=86400')
  c.header('Content-Type', ct)
  return c.body(buf)
})
