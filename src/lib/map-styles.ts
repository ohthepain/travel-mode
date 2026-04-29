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
/** Preset MapTiler `map` ids only. */
export type MapPresetId = (typeof MapStyle)[MapStyleKey]
/** Active basemap id: a preset or the optional custom id from `VITE_MAPTILER_RASTER_MAP_ID`. */
export type RasterMapId = string

const ALLOWED = new Set<string>(Object.values(MapStyle))

/**
 * Custom MapTiler Cloud map slug from env (client + server). Must match the map in your account.
 */
export function getConfiguredCustomMapId(): string | undefined {
  const fromImport =
    typeof import.meta !== 'undefined' &&
    typeof import.meta.env.VITE_MAPTILER_RASTER_MAP_ID === 'string'
      ? import.meta.env.VITE_MAPTILER_RASTER_MAP_ID.trim()
      : ''
  const fromProcess =
    typeof process !== 'undefined' && typeof process.env !== 'undefined'
      ? (
          process.env.VITE_MAPTILER_RASTER_MAP_ID ??
          ''
        ).trim()
      : ''
  const raw = fromImport || fromProcess
  return raw.length > 0 ? raw : undefined
}

/** Default basemap when the app boots: env custom map, else Base preset. */
export function defaultRasterMapId(): RasterMapId {
  return getConfiguredCustomMapId() ?? MapStyle.Base
}

export function isPresetRasterMapId(id: string): id is MapPresetId {
  return ALLOWED.has(id)
}

export function isAllowedRasterMapId(id: string): id is RasterMapId {
  if (ALLOWED.has(id)) return true
  const custom = getConfiguredCustomMapId()
  return custom != null && id === custom
}

/** Preset-only options; UI may prepend an env custom map row (see Flight page). */
export const MAP_STYLE_DROPDOWN: { value: MapPresetId; label: string }[] = [
  { value: MapStyle.Base, label: 'Base' },
  { value: MapStyle.Streets, label: 'Streets' },
  { value: MapStyle.Satellite, label: 'Satellite' },
  { value: MapStyle.Hybrid, label: 'Hybrid' },
  { value: MapStyle.Outdoor, label: 'Outdoor' },
  { value: MapStyle.Topo, label: 'Topo' },
  { value: MapStyle.Dataviz, label: 'Dataviz' },
]
