import type { Feature, FeatureCollection, Geometry } from 'geojson'

export type GeoFeatureCategory =
  | 'city'
  | 'town'
  | 'country'
  | 'region'
  | 'airport'
  | 'water'
  | 'landmark'
  | 'other'

export type GeoFeatureProperties = {
  id: string
  name: string
  category: GeoFeatureCategory
  importance: number
  population?: number
  sources: string[]
  sourceIds: string[]
  wikidataId?: string
  countryCode?: string
  adminCode?: string
}

export type GeoFeature = Feature<Geometry, GeoFeatureProperties>
export type GeoFeatureCollection = FeatureCollection<Geometry, GeoFeatureProperties>

export function importanceFromPopulation(population: number | undefined): number {
  if (!population || population <= 0) return 25
  return Math.round(Math.min(100, Math.max(30, 18 + Math.log10(population) * 12)))
}

function normalizedName(name: string): string {
  return name
    .toLocaleLowerCase('en-US')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function pointMergeKey(feature: GeoFeature): string | null {
  if (feature.geometry.type !== 'Point') return null
  const [lon, lat] = feature.geometry.coordinates
  return [
    feature.properties.category,
    normalizedName(feature.properties.name),
    Math.round(lon * 10) / 10,
    Math.round(lat * 10) / 10,
  ].join(':')
}

export function geoFeatureMergeKey(feature: GeoFeature): string {
  if (feature.properties.wikidataId) return `wikidata:${feature.properties.wikidataId}`
  return pointMergeKey(feature) ?? `${feature.properties.category}:${normalizedName(feature.properties.name)}`
}

export function mergeGeoFeatures(features: GeoFeature[]): GeoFeature[] {
  const merged = new Map<string, GeoFeature>()

  for (const feature of features) {
    const key = geoFeatureMergeKey(feature)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, structuredClone(feature))
      continue
    }

    const population = Math.max(
      existing.properties.population ?? 0,
      feature.properties.population ?? 0,
    )
    const keepIncomingGeometry =
      feature.properties.importance > existing.properties.importance ||
      (feature.properties.importance === existing.properties.importance &&
        (feature.properties.population ?? 0) > (existing.properties.population ?? 0))

    merged.set(key, {
      type: 'Feature',
      geometry: keepIncomingGeometry ? feature.geometry : existing.geometry,
      properties: {
        ...existing.properties,
        ...feature.properties,
        id: existing.properties.wikidataId
          ? existing.properties.id
          : feature.properties.wikidataId
            ? feature.properties.id
            : existing.properties.id,
        importance: Math.max(existing.properties.importance, feature.properties.importance),
        population: population > 0 ? population : undefined,
        sources: Array.from(new Set([...existing.properties.sources, ...feature.properties.sources])).sort(),
        sourceIds: Array.from(
          new Set([...existing.properties.sourceIds, ...feature.properties.sourceIds]),
        ).sort(),
        wikidataId: existing.properties.wikidataId ?? feature.properties.wikidataId,
      },
    })
  }

  return Array.from(merged.values()).sort((a, b) => {
    const byImportance = b.properties.importance - a.properties.importance
    if (byImportance !== 0) return byImportance
    return a.properties.name.localeCompare(b.properties.name)
  })
}

export function featureCollection(features: GeoFeature[]): GeoFeatureCollection {
  return {
    type: 'FeatureCollection',
    features,
  }
}
