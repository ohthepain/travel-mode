import { createFileRoute } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlightMap } from '../../components/FlightMap'
import { wrapDegrees180 } from '../../lib/angle'
import { cn } from '../../lib/cn'
import {
  defaultRasterMapId,
  getConfiguredCustomMapId,
  isAllowedRasterMapId,
  MAP_STYLE_DROPDOWN,
} from '../../lib/map-styles'
import { effectiveFlightMapBbox } from '../../lib/route-bbox-expand'
import {
  flightTrackDurationMs,
  trackBearingTurf,
  useFlightStore,
} from '../../stores/flight'
import { useAppOptionsStore } from '#/stores/app-options'

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
  const loadGeoFeaturesFromIdb = useFlightStore((s) => s.loadGeoFeaturesFromIdb)
  const geoFeatures = useFlightStore((s) => s.geoFeatures)
  const positionAtElapsedMs = useFlightStore((s) => s.positionAtElapsedMs)
  const mapMode = useFlightStore((s) => s.mapMode)
  const lastTracksPayload = useFlightStore((s) => s.lastTracksPayload)
  const rasterMapId = useFlightStore((s) => s.rasterMapId)
  const setRasterMapId = useFlightStore((s) => s.setRasterMapId)

  /** Native <select> breaks if value is not among <option> (e.g. stale id from an old pack). */
  useEffect(() => {
    if (!isAllowedRasterMapId(rasterMapId)) {
      setRasterMapId(defaultRasterMapId())
    }
  }, [rasterMapId, setRasterMapId])

  const customMapId = getConfiguredCustomMapId()

  const selectRasterValue = isAllowedRasterMapId(rasterMapId)
    ? rasterMapId
    : defaultRasterMapId()

  const devMode = useAppOptionsStore((s) => s.devMode)
  const [showTracksJson, setShowTracksJson] = useState(false)

  const packDateKey = travelDateQ ?? 'latest'
  const mapSessionKey = `${fn}:${packDateKey}`
  useEffect(() => {
    useFlightStore.getState().setFlight(fn, travelDateQ)
  }, [fn, travelDateQ])

  useEffect(() => {
    const st = useFlightStore.getState()
    st.clearTrackData()
    st.setUseOffline(false)
    void st.loadPackFromIdb()
  }, [fn, packDateKey])

  const durationMs = useMemo(() => flightTrackDurationMs(line), [line])
  const [elapsedMs, setElapsedMs] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false)
  /** Heading-up: map rotates with track, icon fixed nose-up. North-up: map bearing 0, icon shows track direction. */
  const [followMode, setFollowMode] = useState(false)
  /**
   * Online: vector MapTiler style for the selected map id + hide placenames. Offline: cached raster — labels may show.
   */
  const [hideBasemapLabels, setHideBasemapLabels] = useState(true)
  const playbackAnchorWallMs = useRef(0)
  const playbackAnchorElapsedMs = useRef(0)

  useEffect(() => {
    setElapsedMs(0)
    setIsPlaying(false)
    setHasStartedPlayback(false)
    setFollowMode(false)
    setHideBasemapLabels(false)
  }, [mapSessionKey])

  useEffect(() => {
    if (durationMs == null) return
    setElapsedMs((e) => (e > durationMs ? durationMs : e))
  }, [durationMs])

  useEffect(() => {
    if (!isPlaying || durationMs == null) return
    let id = 0
    const tick = () => {
      const next = Math.min(
        durationMs,
        Date.now() -
          playbackAnchorWallMs.current +
          playbackAnchorElapsedMs.current,
      )
      setElapsedMs(next)
      if (next >= durationMs) {
        setIsPlaying(false)
        return
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [isPlaying, durationMs])

  const onTakeOff = useCallback(() => {
    if (durationMs == null) return
    const baseElapsed = hasStartedPlayback ? elapsedMs : 0
    if (!hasStartedPlayback) {
      setElapsedMs(0)
      setHasStartedPlayback(true)
    }
    playbackAnchorElapsedMs.current = baseElapsed
    playbackAnchorWallMs.current = Date.now()
    setIsPlaying(true)
  }, [durationMs, hasStartedPlayback, elapsedMs])

  const pos =
    positionAtElapsedMs(elapsedMs) ??
    (line && line.geometry.coordinates[0]
      ? (line.geometry.coordinates[0] as [number, number])
      : null)
  const center: [number, number] = pos ?? [0, 20]
  const zoom = line ? 5 : 2
  /** API bbox ∪ line bounds, extended past track ends so maps/tiles reach the destination when ADS-B stops early. */
  const mapBbox = useMemo(
    () => effectiveFlightMapBbox(line, bbox),
    [line, bbox],
  )
  const canSaveOffline = mapBbox != null
  useEffect(() => {
    void loadGeoFeaturesFromIdb()
  }, [
    loadGeoFeaturesFromIdb,
    mapBbox?.[0],
    mapBbox?.[1],
    mapBbox?.[2],
    mapBbox?.[3],
    line,
  ])
  const initialOfflineCenter = useMemo((): [number, number] => {
    const c0 = line?.geometry.coordinates[0] as [number, number] | undefined
    if (c0) return c0
    if (mapBbox)
      return [(mapBbox[0] + mapBbox[2]) / 2, (mapBbox[1] + mapBbox[3]) / 2]
    return [0, 20]
  }, [fn, packDateKey, line, mapBbox])

  const trackBearingTurfDeg = useMemo(
    () => trackBearingTurf(line, elapsedMs),
    [line, elapsedMs],
  )
  const mapBearing = useMemo(() => {
    if (!followMode) return 0
    if (trackBearingTurfDeg == null) return 0
    // Heading-up: rotate the map so track direction sits at the top of the screen (compensate for heading).
    // Use the same numeric compass angle as Turf (° clockwise from north); negating was rotating with the track.
    return wrapDegrees180(trackBearingTurfDeg)
  }, [followMode, trackBearingTurfDeg])

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
    setMsg('Downloading map, route, and geo features…')
    try {
      await downloadTiles()
      setMsg('Map, route, and geo features saved for offline use.')
    } catch (e) {
      setMsg(
        e instanceof Error
          ? e.message
          : 'Download failed. Set VITE_MAPTILER_API_KEY in .env (server proxies tiles).',
      )
    }
  }, [downloadTiles, fn, travelDateQ, setFlight])

  const offlineSection = (
    <section className="mt-4 max-w-3xl rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] p-4 lg:mt-0 lg:max-w-none">
      <h2 className="mb-2 mt-0 text-lg text-[var(--sea-ink)]">
        Offline adjustments
      </h2>
      <p className="mb-3 text-sm text-[var(--sea-ink-soft)]">
        If the flight is late, nudge the takeoff time. Fine-tune the plane
        marker with east / north offset (meters) if the view does not line up.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-[var(--sea-ink)]">
          <span>Reference takeoff (local)</span>
          <input
            type="datetime-local"
            className="rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 text-[var(--sea-ink)]"
            value={isoLocal(takeoff)}
            onChange={(e) => {
              const d = new Date(e.target.value)
              if (!Number.isNaN(d.getTime())) setTakeoff(d)
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--sea-ink)]">
          <span>Takeoff offset (min)</span>
          <input
            type="number"
            className="rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 text-[var(--sea-ink)]"
            value={offMin}
            onChange={(e) => setTakeoffOffset(Number(e.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--sea-ink)]">
          <span>Correction E (m)</span>
          <input
            type="number"
            className="rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 text-[var(--sea-ink)]"
            value={c.e}
            onChange={(e) => setCorrection(Number(e.target.value) || 0, c.n)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--sea-ink)]">
          <span>Correction N (m)</span>
          <input
            type="number"
            className="rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 text-[var(--sea-ink)]"
            value={c.n}
            onChange={(e) => setCorrection(c.e, Number(e.target.value) || 0)}
          />
        </label>
      </div>
    </section>
  )

  const flightMap = (
    <FlightMap
      line={line}
      useOfflineRaster={useOffline}
      center={center}
      zoom={zoom}
      plane={pos}
      bbox={mapBbox}
      mapSessionKey={mapSessionKey}
      initialOfflineCenter={initialOfflineCenter}
      mapBearing={mapBearing}
      followMode={followMode}
      planeTrackBearingDeg={trackBearingTurfDeg}
      geoFeatures={geoFeatures}
      rasterMapId={rasterMapId}
      hideBasemapLabels={hideBasemapLabels}
      onFollowModeChange={setFollowMode}
      className={cn(
        mapMode && 'flex min-h-0 flex-1 flex-col',
        !mapMode && 'lg:flex lg:h-full lg:min-h-0 lg:flex-1 lg:flex-col',
      )}
      mapClassName={cn(
        mapMode &&
          'h-full min-h-[280px] flex-1 rounded-none max-lg:min-h-[min(72dvh,620px)]',
        !mapMode && 'lg:h-full lg:min-h-0 lg:flex-1 lg:rounded-none',
      )}
    />
  )

  return (
    <main
      className={cn(
        'w-full bg-[var(--bg-base)] text-[var(--sea-ink)]',
        mapMode
          ? 'fixed inset-x-0 bottom-0 top-14 z-10 flex flex-col'
          : 'flex min-h-0 flex-col pb-8 pt-6 max-lg:mx-auto max-lg:max-w-lg max-lg:px-3 sm:max-lg:max-w-xl sm:max-lg:px-4 lg:mx-0 lg:max-w-none lg:min-h-[calc(100dvh-3.5rem)] lg:flex-row lg:p-0 lg:pb-0 lg:pt-0',
      )}
    >
      {mapMode ? (
        <div className="flex min-h-0 flex-1 flex-col">{flightMap}</div>
      ) : (
        <>
          <div className="order-1 flex min-w-0 flex-col lg:order-1 lg:w-[min(28rem,42vw)] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-[var(--line)] lg:px-5 lg:py-5">
            <div className="mb-4 flex flex-col gap-1">
              <p className="m-0 text-sm tracking-wide text-[var(--lagoon-deep)]">
                travelmode.live
              </p>
              <h1 className="m-0 text-2xl font-semibold text-[var(--sea-ink)]">
                Flight {fn}
              </h1>
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
                {devMode && (
                  <button
                    type="button"
                    className="rounded-lg border border-amber-700/80 bg-amber-950/50 px-3 py-2 text-amber-100/90 text-sm"
                    onClick={() => setShowTracksJson((v) => !v)}
                    title={
                      lastTracksPayload == null
                        ? 'Load tracks first'
                        : undefined
                    }
                  >
                    {showTracksJson ? 'Hide' : 'Show'} tracks JSON
                  </button>
                )}
              </div>
            </div>

            {devMode && showTracksJson && (
              <div className="mb-3 max-w-3xl">
                {lastTracksPayload == null ? (
                  <p className="text-slate-500 m-0 text-sm">
                    No track payload yet — use Load tracks, or open a flight
                    saved for offline.
                  </p>
                ) : (
                  <pre className="max-h-[min(50vh,360px)] overflow-auto rounded-lg border border-slate-700 bg-slate-950/90 p-3 text-xs text-slate-200 tabular-nums">
                    {stringifyTracksDebug(lastTracksPayload)}
                  </pre>
                )}
              </div>
            )}

            {msg && <p className="mb-2 text-amber-200">{msg}</p>}

            <div className="mb-3 flex flex-wrap items-end gap-2">
              <label className="relative z-20 flex min-w-0 flex-col gap-1 text-sm text-slate-300">
                <span className="text-slate-500">
                  Map style (download and online)
                </span>
                <select
                  className="min-w-36 appearance-auto rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-slate-100"
                  value={selectRasterValue}
                  disabled={Boolean(tileProgress)}
                  title={
                    tileProgress
                      ? 'Wait until Save for offline finishes'
                      : useOffline
                        ? 'Changing basemap turns off offline mode so the new style can load online tiles'
                        : 'MapTiler basemap: used for live view and the next Save for offline'
                  }
                  onChange={(e) => {
                    const v = e.target.value
                    if (!isAllowedRasterMapId(v)) return
                    if (useOffline && v !== rasterMapId) {
                      setUseOffline(false)
                      setMsg(
                        'Offline mode turned off so the new basemap can load online tiles. Save for offline again if you need this style cached.',
                      )
                    }
                    setRasterMapId(v)
                  }}
                >
                  {customMapId ? (
                    <option value={customMapId} title={`Custom map id: ${customMapId}`}>
                      Custom ({customMapId})
                    </option>
                  ) : null}
                  {MAP_STYLE_DROPDOWN.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {useOffline && !tileProgress ? (
                  <span className="max-w-xs text-xs text-slate-500">
                    Choosing another basemap here turns off Offline mode so
                    tiles can load from the network.
                  </span>
                ) : null}
              </label>
              <button
                type="button"
                onClick={onDownload}
                disabled={Boolean(tileProgress) || !canSaveOffline}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                title={
                  canSaveOffline
                    ? 'Caches map tiles, geo feature tiles, and this route for offline'
                    : 'Load tracks first so the map area is known, then you can save it for offline'
                }
              >
                {tileProgress && (
                  <Loader2
                    className="size-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                )}
                {tileProgress
                  ? `${tileProgress.done} / ${tileProgress.total} files`
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
              <label
                className="inline-flex min-w-0 max-w-sm items-center gap-2 text-sm"
                title={
                  useOffline
                    ? 'Offline uses cached raster tiles; hiding basemap labels applies in online vector mode only.'
                    : 'Loads MapTiler vector style via the app proxy (same map id as the basemap picker) and hides basemap symbol text. Supports presets and a custom Cloud map via VITE_MAPTILER_RASTER_MAP_ID.'
                }
              >
                <input
                  type="checkbox"
                  checked={hideBasemapLabels}
                  disabled={useOffline}
                  onChange={(e) => setHideBasemapLabels(e.target.checked)}
                />
                <span
                  className={useOffline ? 'text-slate-500' : 'text-slate-200'}
                >
                  Hide basemap labels (online)
                </span>
              </label>
            </div>
            {tileProgress && (
              <p className="text-slate-400 mb-2 text-sm tabular-nums">
                Saving map for offline — files {tileProgress.done} /{' '}
                {tileProgress.total}
              </p>
            )}

            <div className="mb-2 text-slate-500 text-sm">
              {useOffline && mapBbox ? (
                <>
                  Offline map stays within downloaded tiles (pan when zoomed in;
                  zoom does not move your pan target).
                </>
              ) : (
                <>
                  Map center follows playback position
                  {mapBbox
                    ? ` — bbox W:${mapBbox[0].toFixed(2)} S:${mapBbox[1].toFixed(2)} E:${mapBbox[2].toFixed(2)} N:${mapBbox[3].toFixed(2)}`
                    : ''}
                  {useOffline && (
                    <span className="text-slate-400">
                      {' '}
                      — load tracks (or open this page after saving for offline)
                      so the map can limit the view to cached tiles.
                    </span>
                  )}
                </>
              )}
            </div>

            <section className="mb-3 max-w-3xl rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <h2 className="mb-2 mt-0 text-base font-medium text-white">
                Flight playback
              </h2>
              <p className="text-slate-500 mb-3 text-sm tabular-nums">
                Elapsed {formatElapsedHms(elapsedMs)}
                {durationMs != null && <> / {formatElapsedHms(durationMs)}</>}
              </p>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-cyan-700/80 bg-cyan-950/80 px-3 py-2 text-sm font-medium text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={durationMs == null || isPlaying}
                  onClick={onTakeOff}
                >
                  {isPlaying
                    ? 'In flight…'
                    : hasStartedPlayback
                      ? 'Resume'
                      : 'Take off'}
                </button>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-slate-400">Scrub along track</span>
                <input
                  type="range"
                  className="w-full disabled:opacity-50"
                  min={0}
                  max={durationMs ?? 0}
                  step={1}
                  value={
                    durationMs != null ? Math.min(elapsedMs, durationMs) : 0
                  }
                  disabled={durationMs == null}
                  onChange={(e) => {
                    setIsPlaying(false)
                    setElapsedMs(Number(e.currentTarget.value))
                  }}
                />
              </label>
            </section>

            <div className="hidden lg:mt-4 lg:block">{offlineSection}</div>
          </div>

          <div className="order-2 flex min-h-0 min-w-0 flex-col lg:order-2 lg:flex-1 lg:min-h-0">
            {flightMap}
          </div>

          <div className="order-3 lg:hidden">{offlineSection}</div>
        </>
      )}
    </main>
  )
}

function isoLocal(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`
}

function formatElapsedHms(ms: number) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return `${m}:${String(sec).padStart(2, '0')}`
}

function stringifyTracksDebug(v: unknown): string {
  try {
    return JSON.stringify(
      v,
      (_, x) => (typeof x === 'bigint' ? x.toString() : x),
      2,
    )
  } catch {
    return String(v)
  }
}
