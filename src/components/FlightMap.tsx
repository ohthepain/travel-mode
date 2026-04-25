import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import type { Feature, LineString } from 'geojson'
import { getTileData } from '../lib/tile-idb'
import { cn } from '../lib/cn'
import {
  centerOnPlaneWithBBoxNudge,
  clampCenterToContainBBox,
  minZoomToContainViewportInBBox,
  viewportFitsInBBox,
} from '../lib/map-bbox-clamp'
import { normalizeBearing360, wrapDegrees180 } from '../lib/angle'
import { appMapTileUrlTemplate } from '../lib/tiles'
import 'maplibre-gl/dist/maplibre-gl.css'

const OFF = 'offtm'

/** Top-down plane, nose toward -Y (straight up in SVG / screen before MapLibre rotation). White fill, amber outline. */
const PLANE_PATH_D =
  'M 0 -22 L 4 -7 L 20 -4 L 20 2 L 4 -0.5 L 3 17 L -3 17 L -4 -0.5 L -20 2 L -20 -4 L -4 -7 Z'

const PLANE_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-24 -24 48 48" width="44" height="44" aria-hidden="true"><path fill="#ffffff" stroke="#f59e0b" stroke-width="2.25" stroke-linejoin="round" d="${PLANE_PATH_D}"/></svg>`

function formatHeadingLabel(trackDeg: number | null): string {
  if (trackDeg == null || Number.isNaN(trackDeg)) return '—'
  return `${Math.round(normalizeBearing360(trackDeg))}°`
}

function createPlaneMarkerElement(): HTMLElement {
  const root = document.createElement('div')
  root.className = 'flight-map-plane-marker'
  root.style.display = 'flex'
  root.style.alignItems = 'center'
  root.style.justifyContent = 'center'
  root.style.pointerEvents = 'none'
  root.innerHTML = PLANE_MARKER_SVG
  return root
}

let greyPng256: ArrayBuffer | null = null
async function missingOfflineTilePng(): Promise<ArrayBuffer> {
  if (greyPng256) return greyPng256
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d context')
  ctx.fillStyle = '#52525b'
  ctx.fillRect(0, 0, 256, 256)
  const blob = await new Promise<Blob | null>((res) => {
    c.toBlob((b) => res(b), 'image/png')
  })
  if (!blob) throw new Error('grey tile toBlob')
  greyPng256 = await blob.arrayBuffer()
  return greyPng256
}

export type FlightMapProps = {
  line: Feature<LineString> | null
  useOfflineRaster: boolean
  center: [number, number]
  zoom: number
  plane: [number, number] | null
  bbox: [number, number, number, number] | null
  /** Resets offline pan anchor when this changes (e.g. flight + date). */
  mapSessionKey: string
  /** Seed for offline user anchor; not driven by live position updates. */
  initialOfflineCenter: [number, number]
  /** MapLibre bearing in degrees (CCW from north). Heading-up when followMode; otherwise 0 (north-up). */
  mapBearing: number
  /** When true (heading-up), map rotates with track and the plane icon stays nose-up. When false (north-up), map bearing is 0 and the icon rotates. */
  followMode: boolean
  /** Turf-style track bearing (° clockwise from north); used for the plane icon in north-up mode only. */
  planeTrackBearingDeg: number | null
  onFollowModeChange: (next: boolean) => void
}

function parseOfftmUrl(url: string) {
  const m = /offtm:\/\/(\d+)\/(\d+)\/(\d+)/.exec(url)
  if (!m) return null
  return { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) }
}

function addOrUpdateRoute(m: maplibregl.Map, line: Feature<LineString> | null) {
  if (!m.getSource('route')) {
    if (!line) return
    m.addSource('route', { type: 'geojson', data: line as GeoJSON.GeoJSON })
    m.addLayer({
      id: 'route',
      type: 'line',
      source: 'route',
      paint: { 'line-color': '#2dd4bf', 'line-width': 3, 'line-opacity': 0.9 },
    })
    return
  }
  const src = m.getSource('route') as maplibregl.GeoJSONSource
  if (line) {
    src.setData(line)
  } else {
    if (m.getLayer('route')) m.removeLayer('route')
    m.removeSource('route')
  }
}

export function FlightMap({
  line,
  useOfflineRaster,
  center,
  zoom,
  plane,
  bbox,
  mapSessionKey,
  initialOfflineCenter,
  mapBearing,
  followMode,
  planeTrackBearingDeg,
  onFollowModeChange,
}: FlightMapProps) {
  const el = useRef<HTMLDivElement | null>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const marker = useRef<maplibregl.Marker | null>(null)
  const userAnchorRef = useRef<[number, number]>(initialOfflineCenter)
  const lastSessionKeyRef = useRef(mapSessionKey)
  /** Online: after user pans/zooms the map, do not snap back to plane on the next prop-driven jumpTo. */
  const userOverrideViewRef = useRef(false)
  const [err, setErr] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  /** Latest bearing for offline bbox clamp (avoid reattaching effect on every playback tick). */
  const mapBearingRef = useRef(mapBearing)
  mapBearingRef.current = mapBearing

  useEffect(() => {
    userOverrideViewRef.current = false
  }, [mapSessionKey, useOfflineRaster])

  useEffect(() => {
    if (lastSessionKeyRef.current !== mapSessionKey) {
      lastSessionKeyRef.current = mapSessionKey
      userAnchorRef.current = initialOfflineCenter
    }
  }, [mapSessionKey, initialOfflineCenter])

  useEffect(() => {
    if (!el.current) return
    setMapReady(false)
    if (useOfflineRaster) {
      maplibregl.addProtocol(OFF, async (req) => {
        const t = parseOfftmUrl(req.url)
        if (!t) throw new Error('offtm url')
        const data = await getTileData(t)
        if (!data) {
          return {
            data: await missingOfflineTilePng(),
            cacheControl: 'no-cache' as const,
          }
        }
        return { data, cacheControl: 'immutable' as const }
      })
    }

    const tiles = useOfflineRaster ? [`${OFF}://{z}/{x}/{y}`] : [appMapTileUrlTemplate()]
    setErr(null)

    const startCenter: [number, number] =
      useOfflineRaster && bbox != null ? initialOfflineCenter : center

    const m = new maplibregl.Map({
      container: el.current,
      style: {
        version: 8,
        sources:
          tiles.length > 0
            ? {
                basemap: {
                  type: 'raster',
                  tiles,
                  tileSize: 256,
                  attribution: useOfflineRaster
                    ? 'Offline tiles (MapTiler / OSM, cached locally)'
                    : 'MapTiler / OSM',
                },
              }
            : {},
        layers:
          tiles.length > 0
            ? [
                {
                  id: 'basemap',
                  type: 'raster',
                  source: 'basemap',
                  minzoom: 0,
                  maxzoom: 14,
                },
              ]
            : [],
      },
      center: startCenter,
      zoom,
    })
    m.addControl(new maplibregl.NavigationControl(), 'top-right')
    m.once('load', () => {
      setMapReady(true)
    })
    map.current = m
    return () => {
      setMapReady(false)
      marker.current?.remove()
      marker.current = null
      m.remove()
      map.current = null
      if (useOfflineRaster) maplibregl.removeProtocol(OFF)
    }
  }, [useOfflineRaster, mapSessionKey])

  useEffect(() => {
    const m = map.current
    if (!m || !mapReady) return
    addOrUpdateRoute(m, line)
  }, [line, mapReady])

  const [centerLng, centerLat] = center
  const [planeLng, planeLat] = plane ?? [NaN, NaN]

  useEffect(() => {
    const m = map.current
    if (!m || !mapReady || useOfflineRaster) return
    if (followMode) return
    if (userOverrideViewRef.current) return
    // Depend on numeric coords, not the `center` tuple identity — parent often passes a new
    // array each render (same values), which would reset the map after every pan.
    m.jumpTo({ center: [centerLng, centerLat], zoom, bearing: mapBearing })
  }, [centerLng, centerLat, zoom, mapBearing, mapReady, useOfflineRaster, followMode])

  /** Follow mode: keep map centered on the plane (single bbox nudge when offline / bbox set). */
  useEffect(() => {
    const m = map.current
    if (!m || !mapReady || !followMode) return
    if (plane == null || Number.isNaN(planeLng) || Number.isNaN(planeLat)) return
    const z = useOfflineRaster ? Math.max(zoom, m.getMinZoom()) : zoom
    let L = planeLng
    let φ = planeLat
    if (bbox) {
      ;[L, φ] = centerOnPlaneWithBBoxNudge(m, planeLng, planeLat, bbox, z, mapBearing)
    }
    m.jumpTo({ center: [L, φ], zoom: z, bearing: mapBearing })
    if (useOfflineRaster) userAnchorRef.current = [L, φ]
  }, [
    followMode,
    mapReady,
    planeLng,
    planeLat,
    mapBearing,
    zoom,
    useOfflineRaster,
    bbox?.[0],
    bbox?.[1],
    bbox?.[2],
    bbox?.[3],
  ])

  useEffect(() => {
    const m = map.current
    if (!m || !mapReady || useOfflineRaster) return
    const onMoveEnd = (e: maplibregl.MapLibreEvent<MouseEvent | TouchEvent | WheelEvent | undefined>) => {
      if (e.originalEvent != null) userOverrideViewRef.current = true
    }
    m.on('moveend', onMoveEnd)
    return () => {
      m.off('moveend', onMoveEnd)
    }
  }, [mapReady, useOfflineRaster])

  useEffect(() => {
    const m = map.current
    if (!m || !mapReady) return

    if (!useOfflineRaster || !bbox) {
      m.setMaxBounds(null)
      m.setMinZoom(0)
      m.scrollZoom.enable()
      m.touchZoomRotate.enable()
      m.doubleClickZoom.enable()
      return
    }

    const [west, south, east, north] = bbox
    const zMin = minZoomToContainViewportInBBox(m, bbox)
    m.setMinZoom(zMin)
    if (m.getZoom() < zMin) m.setZoom(zMin)
    m.setMaxBounds([
      [west, south],
      [east, north],
    ])
    m.scrollZoom.disable()
    m.touchZoomRotate.disable()
    m.doubleClickZoom.disable()

    const syncFromAnchor = () => {
      const [lng, lat] = userAnchorRef.current
      if (viewportFitsInBBox(m, bbox)) return
      const [L, φ] = clampCenterToContainBBox(m, lng, lat, bbox)
      m.jumpTo({ center: [L, φ], bearing: mapBearingRef.current })
    }

    const onMoveEnd = () => {
      const c = m.getCenter()
      userAnchorRef.current = [c.lng, c.lat]
    }

    const onZoomEnd = () => {
      const minZ = m.getMinZoom()
      if (m.getZoom() < minZ) m.setZoom(minZ)
      syncFromAnchor()
    }

    const onResize = () => {
      const zMin2 = minZoomToContainViewportInBBox(m, bbox)
      m.setMinZoom(zMin2)
      if (m.getZoom() < zMin2) m.setZoom(zMin2)
      syncFromAnchor()
    }

    syncFromAnchor()

    m.on('moveend', onMoveEnd)
    m.on('zoomend', onZoomEnd)
    m.on('resize', onResize)

    return () => {
      m.off('moveend', onMoveEnd)
      m.off('zoomend', onZoomEnd)
      m.off('resize', onResize)
      m.setMaxBounds(null)
      m.setMinZoom(0)
      m.scrollZoom.enable()
      m.touchZoomRotate.enable()
      m.doubleClickZoom.enable()
    }
    // Use bbox edges as deps — parent often passes a new array with the same numbers after
    // store updates, which would re-run this effect and snap the map via syncFromAnchor().
  }, [
    useOfflineRaster,
    mapReady,
    mapSessionKey,
    bbox?.[0],
    bbox?.[1],
    bbox?.[2],
    bbox?.[3],
  ])

  useEffect(() => {
    const maplib = map.current
    if (!maplib || !mapReady) return
    if (!useOfflineRaster) return
    maplib.setBearing(mapBearing)
  }, [mapReady, useOfflineRaster, mapBearing])

  useEffect(() => {
    const m = map.current
    if (!m || !mapReady) return
    if (plane == null || Number.isNaN(planeLng) || Number.isNaN(planeLat)) {
      marker.current?.remove()
      marker.current = null
      return
    }
    // North-up: only the icon rotates with track. Heading-up: map bears track; icon stays nose-up (0°).
    const trackDeg = planeTrackBearingDeg ?? 0
    const iconRot = followMode ? 0 : wrapDegrees180(trackDeg)
    if (!marker.current) {
      marker.current = new maplibregl.Marker({
        element: createPlaneMarkerElement(),
        anchor: 'center',
        pitchAlignment: 'viewport',
        rotationAlignment: 'viewport',
        rotation: iconRot,
        subpixelPositioning: true,
      })
        .setLngLat([planeLng, planeLat])
        .addTo(m)
    } else {
      marker.current.setLngLat([planeLng, planeLat])
      marker.current.setPitchAlignment('viewport')
      marker.current.setRotationAlignment('viewport')
      marker.current.setRotation(iconRot)
    }
  }, [
    plane,
    planeLng,
    planeLat,
    mapReady,
    mapSessionKey,
    followMode,
    planeTrackBearingDeg,
  ])

  return (
    <div className="relative w-full">
      {err && (
        <p className="bg-amber-500/20 text-amber-100 m-0 rounded-t-xl px-3 py-2 text-sm">{err}</p>
      )}
      <div
        ref={el}
        className={cn(
          'h-[min(60vh,520px)] min-h-[320px] w-full rounded-b-xl',
          useOfflineRaster && 'bg-zinc-600',
        )}
      />
      <div className="absolute top-2 left-2 z-10 flex flex-col items-center gap-1">
        <span
          className="min-h-3.5 text-[0.65rem] font-semibold tabular-nums leading-none tracking-tight text-slate-100"
          aria-hidden
        >
          {followMode ? formatHeadingLabel(planeTrackBearingDeg) : 'N'}
        </span>
        <button
          type="button"
          className={cn(
            'flex size-13 shrink-0 items-center justify-center rounded-full border-2 border-amber-500/85',
            'bg-slate-950/95 text-slate-200 shadow-md backdrop-blur-sm',
            'hover:bg-slate-900/95 disabled:cursor-not-allowed disabled:opacity-50',
          )}
          onClick={() => onFollowModeChange(!followMode)}
          aria-pressed={followMode}
          aria-label={
            followMode
              ? `Heading-up, track ${formatHeadingLabel(planeTrackBearingDeg)}. Switch to north-up.`
              : 'North-up. Switch to heading-up.'
          }
          title={
            followMode
              ? 'Heading-up: map follows direction of travel; plane icon stays pointed up. Click for north-up.'
              : 'North-up: north at the top; plane icon rotates with direction of travel. Click for heading-up.'
          }
        >
          <svg viewBox="0 0 56 56" className="size-[2.85rem]" aria-hidden>
            <circle
              cx="28"
              cy="28"
              r="24"
              className="fill-slate-900/95"
              stroke="#f59e0b"
              strokeWidth="1.75"
            />
            <g
              transform={`translate(28,28) rotate(${followMode ? 0 : planeTrackBearingDeg ?? 0}) scale(0.44)`}
            >
              <path
                d={PLANE_PATH_D}
                fill="#ffffff"
                stroke="#f59e0b"
                strokeWidth="2.25"
                strokeLinejoin="round"
              />
            </g>
          </svg>
        </button>
      </div>
    </div>
  )
}
