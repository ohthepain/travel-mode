import type { Feature, Geometry } from 'geojson'
import JSZip from 'jszip'
import { importanceFromPopulation } from './schema'
import type { GeoFeature, GeoFeatureCategory } from './schema'

export type RawFeature = Feature<Geometry, Record<string, unknown>>

export type GeoFeatureBbox = {
  west: number
  south: number
  east: number
  north: number
}

type LoadGeoNamesOptions = {
  bbox?: GeoFeatureBbox
}

const GEONAMES_CITIES_URL =
  'https://download.geonames.org/export/dump/cities5000.zip'

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/zip,application/octet-stream,*/*',
      'User-Agent': 'travelmode/1.0 (geo feature builder)',
    },
  })
  if (!response.ok) throw new Error(`Fetch failed ${response.status} ${url}`)
  return response.arrayBuffer()
}

function parseMaybeNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function categoryForGeoNames(featureCode: string): GeoFeatureCategory {
  if (
    featureCode === 'PPLC' ||
    featureCode === 'PPLA' ||
    featureCode === 'PPLA2'
  )
    return 'city'
  return 'town'
}

function isInsideBbox(
  lon: number,
  lat: number,
  bbox: GeoFeatureBbox | undefined,
): boolean {
  if (!bbox) return true
  return (
    lon >= bbox.west &&
    lon <= bbox.east &&
    lat >= bbox.south &&
    lat <= bbox.north
  )
}

function geoNamesRowToFeature(
  row: string,
  options: LoadGeoNamesOptions,
): GeoFeature | null {
  const cols = row.split('\t')
  if (cols.length < 19) return null

  const id = cols[0]
  const name = cols[1]
  const lat = Number(cols[4])
  const lon = Number(cols[5])
  const featureClass = cols[6]
  const featureCode = cols[7]
  if (
    !id ||
    !name ||
    featureClass !== 'P' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    return null
  }
  if (!isInsideBbox(lon, lat, options.bbox)) return null

  const population = parseMaybeNumber(cols[14])
  const category = categoryForGeoNames(featureCode)

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [lon, lat],
    },
    properties: {
      id: `geonames:${id}`,
      name,
      category,
      importance: importanceFromPopulation(population),
      population,
      sources: ['geonames'],
      sourceIds: [`geonames:${id}`],
      countryCode: cols[8] || undefined,
      adminCode: cols[10] || undefined,
    },
  }
}

export async function loadGeoNamesCities(
  options: LoadGeoNamesOptions = {},
): Promise<{ raw: RawFeature[]; normalized: GeoFeature[] }> {
  const zip = await JSZip.loadAsync(await fetchArrayBuffer(GEONAMES_CITIES_URL))
  const textFile = zip.file('cities5000.txt')
  if (!textFile)
    throw new Error('GeoNames cities5000.zip did not contain cities5000.txt')

  const rows = (await textFile.async('string')).split('\n')
  const normalized = rows.flatMap((row) => {
    const feature = geoNamesRowToFeature(row, options)
    return feature ? [feature] : []
  })

  return {
    raw: normalized.map((feature) => ({
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        geonameId: feature.properties.id.replace('geonames:', ''),
        name: feature.properties.name,
        population: feature.properties.population,
        countryCode: feature.properties.countryCode,
        adminCode: feature.properties.adminCode,
      },
    })),
    normalized,
  }
}
