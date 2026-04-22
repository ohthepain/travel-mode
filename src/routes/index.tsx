import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { FlightMap } from '../components/FlightMap'
import { useFlightStore } from '../stores/flight'
import { authClient } from '../lib/auth-client'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const [fn, setFn] = useState('D84321')
  const [msg, setMsg] = useState<string | null>(null)
  const session = authClient.useSession()

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
  const loadPackFromIdb = useFlightStore((s) => s.loadPackFromIdb)
  const estimatedPosition = useFlightStore((s) => s.estimatedPosition)

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

  const queueSync = useCallback(async () => {
    setMsg(null)
    setFlight(fn)
    const r = await fetch('/api/flights/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flightNumber: fn }),
    })
    if (!r.ok) {
      setMsg(await r.text())
      return
    }
    setMsg('Sync queued. Wait a few seconds, then load tracks.')
  }, [fn, setFlight])

  const loadTracks = useCallback(async () => {
    setMsg(null)
    setFlight(fn)
    const u = new URL(
      `/api/flights/${encodeURIComponent(fn)}/tracks`,
      window.location.origin,
    )
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
    if (dates && dates.length > 0) setFlight(fn, dates[dates.length - 1])
  }, [fn, setFlight, setLineFromApi])

  const onDownload = useCallback(async () => {
    setFlight(fn)
    setMsg('Downloading tiles (zoom 3–8)…')
    try {
      await downloadTiles()
      setMsg('Tiles and flight pack saved to IndexedDB.')
    } catch (e) {
      setMsg(
        e instanceof Error
          ? e.message
          : 'Download failed. Set VITE_MAPTILER_KEY or MAPTILER_API_KEY in .env (server proxies tiles).',
      )
    }
  }, [downloadTiles, fn, setFlight])

  return (
    <main className="page-wrap bg-slate-950 text-slate-100 px-4 pb-8 pt-6">
      <div className="mb-4 flex flex-col gap-1">
        <p className="m-0 text-sm tracking-wide text-cyan-400/90">
          travelmode.live
        </p>
        <h1 className="m-0 text-2xl font-semibold text-white">
          What you are looking at when you fly
        </h1>
        <p className="m-0 max-w-2xl text-slate-400">
          Enter a flight, sync track data (recent history from Flightradar24),
          download map tiles, then go offline. Position is estimated from your
          corrected takeoff time; pan is not required when the estimate matches
          the window.
        </p>
      </div>

      {session.data?.user && (
        <p className="text-slate-500 mb-2 text-sm">
          Signed in as {session.data.user.email}
        </p>
      )}

      <div className="mb-4 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span>Flight (IATA)</span>
          <input
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={fn}
            onChange={(e) => setFn(e.target.value.toUpperCase())}
          />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            className="rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-slate-950"
            onClick={queueSync}
          >
            Queue sync
          </button>
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
          className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900"
        >
          Download tiles (z3–8) + save pack
        </button>
        <button
          type="button"
          onClick={() => void loadPackFromIdb()}
          className="rounded-lg border border-slate-600 px-3 py-2 text-sm"
        >
          Load saved pack
        </button>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useOffline}
            onChange={(e) => setUseOffline(e.target.checked)}
          />
          Use offline map tiles
        </label>
      </div>
      {tileProgress && (
        <p className="text-slate-400 mb-2 text-sm">
          Tiles: {tileProgress.done} / {tileProgress.total}
        </p>
      )}

      <section className="mb-4 max-w-3xl rounded-xl border border-slate-800 bg-slate-900/50 p-4">
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

      <div className="mb-2 text-slate-500 text-sm">
        Map center uses estimated position
        {bbox
          ? ` — bbox W:${bbox[0].toFixed(2)} S:${bbox[1].toFixed(2)} E:${bbox[2].toFixed(2)} N:${bbox[3].toFixed(2)}`
          : ''}
      </div>

      <FlightMap
        line={line}
        useOfflineRaster={useOffline}
        center={center}
        zoom={zoom}
        plane={pos}
      />
    </main>
  )
}

function isoLocal(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`
}
