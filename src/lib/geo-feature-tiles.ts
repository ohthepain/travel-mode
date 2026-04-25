import type { Feature, FeatureCollection, Geometry, LineString } from 'geojson'

export type DegreeTile = {
  latTile: number
  lonTile: number
  tileId: string
  prefix: string
  bbox: [number, number, number, number]
}

export type GeoFeatureResolution = 'highres' | 'lowres'

export type GeoFeatureProperties = {
  id: string
  name: string
  category: string
  importance: number
  population?: number
  sources: string[]
  sourceIds: string[]
  wikidataId?: string
  countryCode?: string
  adminCode?: string
}

export type GeoFeatureCollection = FeatureCollection<Geometry, GeoFeatureProperties>

function clampFloor(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

export function degreeTileForLonLat(lon: number, lat: number): DegreeTile {
  return degreeTileFromFloors(clampFloor(lat, -90, 89), clampFloor(lon, -180, 179))
}

export function degreeTileFromFloors(latTile: number, lonTile: number): DegreeTile {
  if (!Number.isInteger(latTile) || latTile < -90 || latTile > 89) {
    throw new Error(`Invalid latitude tile ${latTile}; expected -90..89`)
  }
  if (!Number.isInteger(lonTile) || lonTile < -180 || lonTile > 179) {
    throw new Error(`Invalid longitude tile ${lonTile}; expected -180..179`)
  }

  const latLabel = `${latTile >= 0 ? 'N' : 'S'}${Math.abs(latTile)}`
  const lonLabel = `${lonTile >= 0 ? 'E' : 'W'}${Math.abs(lonTile)}`
  return {
    latTile,
    lonTile,
    tileId: `${latTile}_${lonTile}`,
    prefix: `${latLabel}/${lonLabel}`,
    bbox: [lonTile, latTile, lonTile + 1, latTile + 1],
  }
}

export function parseDegreeTilePrefix(input: string): DegreeTile {
  const match = /^([NS])(\d{1,2})\/([EW])(\d{1,3})$/.exec(input.trim())
  if (!match) {
    throw new Error(`Invalid tile "${input}". Use a prefix like N59/E18 or S34/W58.`)
  }

  const latAbs = Number(match[2])
  const lonAbs = Number(match[4])
  const latTile = match[1] === 'N' ? latAbs : -latAbs
  const lonTile = match[3] === 'E' ? lonAbs : -lonAbs
  return degreeTileFromFloors(latTile, lonTile)
}

export function degreeTilesForBbox([west, south, east, north]: [
  number,
  number,
  number,
  number,
]): DegreeTile[] {
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

export function degreeTilesForLineString(line: Feature<LineString> | null): DegreeTile[] {
  if (!line) return []
  const coords = line.geometry.coordinates as [number, number][]
  const byId = new Map<string, DegreeTile>()

  for (let index = 0; index < coords.length; index++) {
    const current = coords[index]
    const next = coords[index + 1]
    if (!next) {
      const tile = degreeTileForLonLat(current[0], current[1])
      byId.set(tile.tileId, tile)
      continue
    }

    const maxDelta = Math.max(Math.abs(next[0] - current[0]), Math.abs(next[1] - current[1]))
    const steps = Math.max(1, Math.ceil(maxDelta * 4))
    for (let step = 0; step <= steps; step++) {
      const t = step / steps
      const lon = current[0] + (next[0] - current[0]) * t
      const lat = current[1] + (next[1] - current[1]) * t
      const tile = degreeTileForLonLat(lon, lat)
      byId.set(tile.tileId, tile)
    }
  }

  return Array.from(byId.values())
}

export function appGeoFeatureTileUrl(tile: DegreeTile, resolution: GeoFeatureResolution): string {
  const base =
    typeof window === 'undefined'
      ? 'http://localhost:3020'
      : window.location.origin
  return `${base}/api/geo-features/${tile.prefix}/v1/tiles/${resolution}.json.gz`
}

export function mergeGeoFeatureCollections(
  collections: GeoFeatureCollection[],
): GeoFeatureCollection {
  const byId = new Map<string, Feature<Geometry, GeoFeatureProperties>>()

  for (const collection of collections) {
    for (const feature of collection.features) {
      const id = feature.properties?.id
      if (!id) continue
      byId.set(id, feature)
    }
  }

  return {
    type: 'FeatureCollection',
    features: Array.from(byId.values()).sort(
      (a, b) => (b.properties.importance ?? 0) - (a.properties.importance ?? 0),
    ),
  }
}

export function isGeoFeatureCollection(value: unknown): value is GeoFeatureCollection {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { type?: unknown; features?: unknown }
  return candidate.type === 'FeatureCollection' && Array.isArray(candidate.features)
}
