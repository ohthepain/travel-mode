/**
 * MapTiler “Maps” raster `mapId` values (path `/maps/{mapId}/256/{z}/{x}/{y}.png`).
 * Default basemap is {@link MapStyle.Base}.
 */
export const MapStyle = {
  /** Neutral underlay, minimal label clutter. */
  Base: 'base-v4',
  /** Road network (vector-style look as raster). */
  Streets: 'streets-v2',
  /** Aerial / satellite, no road labels. */
  Satellite: 'satellite',
  /** Satellite with roads and labels. */
  Hybrid: 'hybrid',
  /** Hiking / terrain context. */
  Outdoor: 'outdoor-v2',
  /** Topographic. */
  Topo: 'topo-v2',
  /** Light cartographic, dashboard-friendly. */
  Dataviz: 'dataviz-v4',
} as const

export type MapStyleKey = keyof typeof MapStyle
export type RasterMapId = (typeof MapStyle)[MapStyleKey]

const ALLOWED = new Set<string>(Object.values(MapStyle))

export function isAllowedRasterMapId(id: string): id is RasterMapId {
  return ALLOWED.has(id)
}

export const MAP_STYLE_DROPDOWN: { value: RasterMapId; label: string }[] = [
  { value: MapStyle.Base, label: 'Base' },
  { value: MapStyle.Streets, label: 'Streets' },
  { value: MapStyle.Satellite, label: 'Satellite' },
  { value: MapStyle.Hybrid, label: 'Hybrid' },
  { value: MapStyle.Outdoor, label: 'Outdoor' },
  { value: MapStyle.Topo, label: 'Topo' },
  { value: MapStyle.Dataviz, label: 'Dataviz' },
]
