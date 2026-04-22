import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import type { Feature, LineString } from 'geojson'
import { getTileData } from '../lib/tile-idb'
import { appMapTileUrlTemplate } from '../lib/tiles'
import 'maplibre-gl/dist/maplibre-gl.css'

const OFF = 'offtm'

type Props = {
  line: Feature<LineString> | null
  useOfflineRaster: boolean
  center: [number, number]
  zoom: number
  plane: [number, number] | null
}

function parseOfftmUrl(url: string) {
  const m = /offtm:\/\/(\d+)\/(\d+)\/(\d+)/.exec(url)
  if (!m) return null
  return { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) }
}

export function FlightMap({ line, useOfflineRaster, center, zoom, plane }: Props) {
  const el = useRef<HTMLDivElement | null>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const marker = useRef<maplibregl.Marker | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!el.current) return
    if (useOfflineRaster) {
      maplibregl.addProtocol(OFF, async (req) => {
        const t = parseOfftmUrl(req.url)
        if (!t) throw new Error('offtm url')
        const data = await getTileData(t)
        if (!data) throw new Error('tile missing in IndexedDB')
        return { data, cacheControl: 'immutable' }
      })
    }

    const tiles = useOfflineRaster
      ? [`${OFF}://{z}/{x}/{y}`]
      : [appMapTileUrlTemplate()]
    setErr(null)

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
      center,
      zoom,
    })
    m.addControl(new maplibregl.NavigationControl(), 'top-right')
    m.once('load', () => {
      if (line) {
        m.addSource('route', { type: 'geojson', data: line as GeoJSON.GeoJSON })
        m.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          paint: { 'line-color': '#2dd4bf', 'line-width': 3, 'line-opacity': 0.9 },
        })
      }
    })
    map.current = m
    return () => {
      marker.current?.remove()
      marker.current = null
      m.remove()
      map.current = null
      if (useOfflineRaster) maplibregl.removeProtocol(OFF)
    }
  }, [center, zoom, line, useOfflineRaster])

  useEffect(() => {
    const m = map.current
    if (!m) return
    marker.current?.remove()
    marker.current = null
    if (plane) {
      marker.current = new maplibregl.Marker({ color: '#f59e0b' }).setLngLat(plane).addTo(m)
    }
  }, [plane])

  return (
    <div className="relative w-full">
      {err && (
        <p className="bg-amber-500/20 text-amber-100 m-0 rounded-t-xl px-3 py-2 text-sm">{err}</p>
      )}
      <div ref={el} className="h-[min(60vh,520px)] min-h-[320px] w-full rounded-b-xl" />
    </div>
  )
}
