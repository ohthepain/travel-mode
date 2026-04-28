import 'dotenv/config'
import { Hono } from 'hono'
import { isAllowedRasterMapId } from '../../lib/map-styles'
import { styleJsonWithKeysStrippedForClient } from '../../lib/maptiler-style-urls'
import { getMapTilerApiKeyFromEnv } from '../../lib/server-maptiler-key'

/** Hosted MapTiler vector `style.json` (same `map` ids as raster); keys stripped. */
export const mapStyleVectorRoutes = new Hono()

mapStyleVectorRoutes.get('/', async (c) => {
  const key = getMapTilerApiKeyFromEnv()
  if (!key) {
    return c.text(
      'Set VITE_MAPTILER_API_KEY (or MAPTILER_API_KEY / VITE_MAPTILER_KEY) in .env',
      503,
    )
  }
  const map = c.req.query('map')?.trim() ?? ''
  if (!isAllowedRasterMapId(map)) {
    return c.text('Invalid map', 400)
  }
  const upstream = new URL(
    `https://api.maptiler.com/maps/${encodeURIComponent(map)}/style.json`,
  )
  upstream.searchParams.set('key', key)
  const r = await fetch(upstream, {
    headers: { Accept: 'application/json' },
  })
  if (!r.ok) {
    c.header('X-Upstream-Status', String(r.status))
    if (r.status === 403) {
      return c.text('MapTiler 403: key not allowed for this map style.', 502)
    }
    return c.text('Upstream error', 502)
  }
  const json = (await r.json()) as unknown
  const out = styleJsonWithKeysStrippedForClient(json)
  // Do not cache the style in the browser/SW: stale JSON once had broken glyph URLs.
  c.header('Cache-Control', 'no-store')
  return c.json(out)
})
