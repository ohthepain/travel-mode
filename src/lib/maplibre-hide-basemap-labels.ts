import type maplibregl from 'maplibre-gl'

/**
 * Hide label text on a MapTiler hosted vector style (symbol layers with `text-field`).
 * Does not hide icon-only symbol layers.
 */
export function hideBasemapTextSymbolLayers(m: maplibregl.Map) {
  const s = m.getStyle()
  if (!s?.layers) return
  for (const layer of s.layers) {
    if (layer.type !== 'symbol') continue
    const layout = layer.layout as Record<string, unknown> | undefined
    if (layout == null || !('text-field' in layout)) continue
    if (!m.getLayer(layer.id)) continue
    m.setLayoutProperty(layer.id, 'visibility', 'none')
  }
}
