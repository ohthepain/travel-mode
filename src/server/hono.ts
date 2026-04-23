import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth, getTrustedOrigins } from './auth'
import { adminRoutes } from './routes/admin'
import { flightRoutes } from './routes/flights'
import { mapTileRoutes } from './routes/map-tiles'

const corsOrigins = getTrustedOrigins()

export const app = new Hono().basePath('/api')

app.use(
  '*',
  cors({
    origin: corsOrigins,
    allowHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Client-Version'],
    exposeHeaders: ['Set-Cookie'],
    credentials: true,
  }),
)

app.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))

app.get('/health', (c) =>
  c.json({ ok: true, service: 'travelmode', ts: new Date().toISOString() }),
)

app.route('/flights', flightRoutes)
app.route('/map-tiles', mapTileRoutes)
app.route('/admin', adminRoutes)
