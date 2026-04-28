import 'dotenv/config'
import { Hono } from 'hono'
import { getMapTilerApiKeyFromEnv } from '../../lib/server-maptiler-key'

/**
 * Forwards a MapTiler URL (with key applied on the server). Used with MapLibre
 * `transformRequest` for vector basemaps so the key stays off the client.
 */
export const maptileCdnRoutes = new Hono()

maptileCdnRoutes.get('/', async (c) => {
  const key = getMapTilerApiKeyFromEnv()
  if (!key) {
    return c.text(
      'Set VITE_MAPTILER_API_KEY (or MAPTILER_API_KEY / VITE_MAPTILER_KEY) in .env',
      503,
    )
  }
  const raw = c.req.query('u')?.trim()
  if (!raw) return c.text('Missing u', 400)
  let target: string
  try {
    target = decodeURIComponent(raw)
  } catch {
    return c.text('Invalid u', 400)
  }
  if (
    !target.startsWith('https://api.maptiler.com/') &&
    !target.startsWith('http://api.maptiler.com/')
  ) {
    return c.text('Invalid upstream host', 400)
  }
  const u = new URL(target)
  if (!u.searchParams.get('key')) u.searchParams.set('key', key)
  const r = await fetch(u, {
    headers: { Accept: '*/*' },
  })
  if (!r.ok) {
    c.header('X-Upstream-Status', String(r.status))
    if (r.status === 403) {
      return c.text(
        'MapTiler 403: key not allowed for this resource (check MapTiler Cloud keys).',
        502,
      )
    }
    return c.text('Upstream error', 502)
  }
  const buf = await r.arrayBuffer()
  const ct = r.headers.get('content-type') ?? 'application/octet-stream'
  c.header('Cache-Control', 'public, max-age=86400, s-maxage=86400')
  c.header('Content-Type', ct)
  return c.body(buf)
})
