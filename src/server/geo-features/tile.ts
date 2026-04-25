import type { BBox, Feature, Geometry } from 'geojson'
import { bbox as turfBbox } from '@turf/turf'
import {
  degreeTileForLonLat,
  degreeTileFromFloors,
  parseDegreeTilePrefix,
  type DegreeTile,
} from '../../lib/geo-feature-tiles'

export { degreeTileForLonLat, degreeTileFromFloors, parseDegreeTilePrefix, type DegreeTile }

function clampFloor(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

export function degreeTilesForFeature(feature: Feature<Geometry>): DegreeTile[] {
  if (feature.geometry.type === 'Point') {
    const [lon, lat] = feature.geometry.coordinates
    return [degreeTileForLonLat(lon, lat)]
  }

  const [west, south, east, north] = turfBbox(feature) as BBox
  const lonStart = clampFloor(west, -180, 179)
  const lonEnd = clampFloor(east, -180, 179)
  const latStart = clampFloor(south, -90, 89)
  const latEnd = clampFloor(north, -90, 89)
  const tiles: DegreeTile[] = []

  for (let lat = latStart; lat <= latEnd; lat++) {
    for (let lon = lonStart; lon <= lonEnd; lon++) {
      tiles.push(degreeTileFromFloors(lat, lon))
    }
  }

  return tiles
}
