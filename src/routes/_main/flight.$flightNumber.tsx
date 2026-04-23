import { createFileRoute } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlightMap } from '../../components/FlightMap'
import { cn } from '../../lib/cn'
import { effectiveFlightMapBbox } from '../../lib/route-bbox-expand'
import { useFlightStore } from '../../stores/flight'

type FlightSearch = { date?: string }

export const Route = createFileRoute('/_main/flight/$flightNumber')({
  validateSearch: (search: Record<string, unknown>): FlightSearch => ({
    date:
      typeof search.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.date)
        ? search.date
        : undefined,
  }),
  component: FlightPage,
})

function FlightPage() {
  const { flightNumber: flightParam } = Route.useParams()
  const { date: travelDateQ } = Route.useSearch()
  const [fn, setFn] = useState(flightParam.toUpperCase())
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    setFn(flightParam.toUpperCase())
  }, [flightParam])

  const line = useFlightStore((s) => s.line)
  const bbox = useFlightStore((s) => s.bbox)
  const setFlight = useFlightStore((s) => s.setFlight)
  const setLineFromApi = useFlightStore((s) => s.setLineFromApi)
  const setTakeoffOffset = useFlightStore((s) => s.setTakeoffOffset)
  const setCorrection = useFlightStore((s) => s.setCorrection)
  const setUseOffline = useFlightStore((s) => s.setUseOffline)
  const useOffline = useFlightStore((s) => s.useOffline)
  const takeoff = useFlightStore((s) => s.takeoff)
  const setTakeoff = useFlightStore((s) => s.setTakeoff)
  const offMin = useFlightStore((s) => s.takeoffOffsetMin)
  const c = useFlightStore((s) => s.correctionEN)
  const tileProgress = useFlightStore((s) => s.tileProgress)
  const downloadTiles = useFlightStore((s) => s.downloadTiles)
  const estimatedPosition = useFlightStore((s) => s.estimatedPosition)
  const mapMode = useFlightStore((s) => s.mapMode)

  const packDateKey = travelDateQ ?? 'latest'
  useEffect(() => {
    useFlightStore.getState().setFlight(fn, travelDateQ)
  }, [fn, travelDateQ])

  useEffect(() => {
    const st = useFlightStore.getState()
    st.clearTrackData()
    st.setUseOffline(false)
    void st.loadPackFromIdb()
  }, [fn, packDateKey])

  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const pos =
    estimatedPosition(clock) ??
    (line && line.geometry.coordinates[0]
      ? (line.geometry.coordinates[0] as [number, number])
      : null)
  const center: [number, number] = pos ?? [0, 20]
  const zoom = line ? 5 : 2

  const mapSessionKey = `${fn}:${packDateKey}`
  /** API bbox ∪ line bounds, extended past track ends so maps/tiles reach the destination when ADS-B stops early. */
  const mapBbox = useMemo(() => effectiveFlightMapBbox(line, bbox), [line, bbox])
  const canSaveOffline = mapBbox != null
  const initialOfflineCenter = useMemo((): [number, number] => {
    const c0 = line?.geometry.coordinates[0] as [number, number] | undefined
    if (c0) return c0
    if (mapBbox) return [(mapBbox[0] + mapBbox[2]) / 2, (mapBbox[1] + mapBbox[3]) / 2]
    return [0, 20]
  }, [fn, packDateKey, line, mapBbox])

  const loadTracks = useCallback(async () => {
    setMsg(null)
    setFlight(fn, travelDateQ)
    const u = new URL(
      `/api/flights/${encodeURIComponent(fn)}/tracks`,
      window.location.origin,
    )
    if (travelDateQ) u.searchParams.set('date', travelDateQ)
    const r = await fetch(u)
    if (!r.ok) {
      setMsg(await r.text())
      return
    }
    const j = (await r.json()) as {
      features: unknown[]
      meta: {
        bbox: [number, number, number, number] | null
        dates?: string[]
      }
    }
    setLineFromApi(j)
    const dates = j.meta.dates
    if (dates && dates.length > 0) {
      const pick =
        travelDateQ && dates.includes(travelDateQ)
          ? travelDateQ
          : dates[dates.length - 1]
      setFlight(fn, pick)
    }
  }, [fn, travelDateQ, setFlight, setLineFromApi])

  const onDownload = useCallback(async () => {
    setFlight(fn, travelDateQ)
    setMsg('Downloading map (zoom 3–8)…')
    try {
      await downloadTiles()
      setMsg('Map and route saved for offline use.')
    } catch (e) {
      setMsg(
        e instanceof Error
          ? e.message
          : 'Download failed. Set VITE_MAPTILER_KEY or MAPTILER_API_KEY in .env (server proxies tiles).',
      )
    }
  }, [downloadTiles, fn, travelDateQ, setFlight])

  return (
    <main
      className={cn(
        'bg-slate-950 text-slate-100 px-3 pb-8 pt-6 sm:px-4',
        mapMode ? 'page-wrap' : 'mx-auto w-full max-w-md sm:max-w-lg',
      )}
    >
      <div className="mb-4 flex flex-col gap-1">
        <p className="m-0 text-sm tracking-wide text-cyan-400/90">
          travelmode.live
        </p>
        <h1 className="m-0 text-2xl font-semibold text-white">Flight {fn}</h1>
      </div>

      <div className="mb-4 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <input
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={fn}
            onChange={(e) => setFn(e.target.value.toUpperCase())}
          />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
            onClick={loadTracks}
          >
            Load tracks
          </button>
        </div>
      </div>

      {msg && <p className="mb-2 text-amber-200">{msg}</p>}

      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onDownload}
          disabled={Boolean(tileProgress) || !canSaveOffline}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          title={
            canSaveOffline
              ? 'Caches map tiles (zoom 3–8) and this route for offline'
              : 'Load tracks first so the map area is known, then you can download tiles for offline'
          }
        >
          {tileProgress && (
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
          )}
          {tileProgress
            ? `${tileProgress.done} / ${tileProgress.total} tiles`
            : 'Save for offline'}
        </button>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useOffline}
            onChange={(e) => setUseOffline(e.target.checked)}
          />
          Offline mode
        </label>
      </div>
      {tileProgress && (
        <p className="text-slate-400 mb-2 text-sm tabular-nums">
          Saving map for offline — tiles {tileProgress.done} /{' '}
          {tileProgress.total}
        </p>
      )}

      <div className="mb-2 text-slate-500 text-sm">
        {useOffline && mapBbox ? (
          <>
            Offline map stays within downloaded tiles (pan when zoomed in; zoom does not move your
            pan target).
          </>
        ) : (
          <>
            Map center follows estimated position
            {mapBbox
              ? ` — bbox W:${mapBbox[0].toFixed(2)} S:${mapBbox[1].toFixed(2)} E:${mapBbox[2].toFixed(2)} N:${mapBbox[3].toFixed(2)}`
              : ''}
            {useOffline && (
              <span className="text-slate-400">
                {' '}
                — load tracks (or open this page after saving for offline) so the map can limit the
                view to cached tiles.
              </span>
            )}
          </>
        )}
      </div>

      <FlightMap
        line={line}
        useOfflineRaster={useOffline}
        center={center}
        zoom={zoom}
        plane={pos}
        bbox={mapBbox}
        mapSessionKey={mapSessionKey}
        initialOfflineCenter={initialOfflineCenter}
      />

      <section className="mt-4 max-w-3xl rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="mb-2 mt-0 text-lg">Offline adjustments</h2>
        <p className="text-slate-500 mb-3 text-sm">
          If the flight is late, nudge the takeoff time. Fine-tune the plane
          marker with east / north offset (meters) if the view does not line up.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span>Reference takeoff (local)</span>
            <input
              type="datetime-local"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={isoLocal(takeoff)}
              onChange={(e) => {
                const d = new Date(e.target.value)
                if (!Number.isNaN(d.getTime())) setTakeoff(d)
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Takeoff offset (min)</span>
            <input
              type="number"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={offMin}
              onChange={(e) => setTakeoffOffset(Number(e.target.value) || 0)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Correction E (m)</span>
            <input
              type="number"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={c.e}
              onChange={(e) => setCorrection(Number(e.target.value) || 0, c.n)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Correction N (m)</span>
            <input
              type="number"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={c.n}
              onChange={(e) => setCorrection(c.e, Number(e.target.value) || 0)}
            />
          </label>
        </div>
      </section>
    </main>
  )
}

function isoLocal(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`
}
