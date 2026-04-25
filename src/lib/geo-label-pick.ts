import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { Map } from 'maplibre-gl'

const GRID = 3
const CELLS = 9

function importanceFromProps(properties: unknown): number {
  if (!properties || typeof properties !== 'object') return 25
  const imp = (properties as { importance?: number }).importance
  if (imp == null || Number.isNaN(imp)) return 25
  return imp
}

/**
 * At most one label per 1/9th of the map container (3×3 grid), choosing the
 * highest-importance point whose projected position falls in that cell and on-screen.
 */
export function pickGeoLabelFeaturesForMapView(
  m: Map,
  collection: FeatureCollection<Geometry> | null,
): FeatureCollection<Geometry> {
  if (!collection?.features.length) {
    return { type: 'FeatureCollection', features: [] }
  }

  const w = m.getContainer().clientWidth
  const h = m.getContainer().clientHeight
  if (w <= 0 || h <= 0) {
    return { type: 'FeatureCollection', features: [] }
  }

  const cellW = w / GRID
  const cellH = h / GRID
  const best: (Feature<Geometry> | null)[] = Array(CELLS).fill(null)
  const bestScore: number[] = Array(CELLS).fill(-Infinity)

  for (const f of collection.features) {
    if (f.geometry?.type !== 'Point') continue
    const coords = f.geometry.coordinates as [number, number]
    const p = m.project(coords)
    if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue
    const col = Math.min(GRID - 1, Math.max(0, Math.floor(p.x / cellW)))
    const row = Math.min(GRID - 1, Math.max(0, Math.floor(p.y / cellH)))
    const idx = row * GRID + col
    const imp = importanceFromProps(f.properties)
    if (imp > bestScore[idx]) {
      bestScore[idx] = imp
      best[idx] = f
    }
  }

  return {
    type: 'FeatureCollection',
    features: best.filter((x): x is Feature<Geometry> => x != null),
  }
}
