import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { featureCollection, mergeGeoFeatures } from './schema'
import type { GeoFeature } from './schema'
import { loadGeoNamesCities } from './sources'
import type { GeoFeatureBbox, RawFeature } from './sources'
import { degreeTilesForFeature, parseDegreeTilePrefix } from './tile'
import type { DegreeTile } from './tile'

type TileAccumulator = {
  tile: DegreeTile
  rawGeoNames: RawFeature[]
  highres: GeoFeature[]
  lowres: GeoFeature[]
}

type CliOptions = {
  dryRun: boolean
  onlyTile: DegreeTile | null
  bbox?: GeoFeatureBbox
}

export type BuildGeoFeaturesOptions = {
  dryRun?: boolean
  onlyTile?: DegreeTile | null
  bbox?: GeoFeatureBbox
}

export type BuildGeoFeaturesResult = {
  bbox?: GeoFeatureBbox
  tilesWritten: number
  rawGeoNames: number
  highres: number
  lowres: number
}

export const EUROPE_GEO_FEATURE_BBOX: GeoFeatureBbox = {
  west: -9,
  south: 35,
  east: 40,
  north: 72,
}

function parseBbox(value: string): GeoFeatureBbox {
  const [west, south, east, north] = value
    .split(',')
    .map((part) => Number(part.trim()))
  if (
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north) ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west > east ||
    south > north
  ) {
    throw new Error('--bbox must be west,south,east,north in decimal degrees')
  }

  return { west, south, east, north }
}

function parseArgs(argv: string[]): CliOptions {
  let dryRun = false
  let onlyTile: DegreeTile | null = null
  let bbox: GeoFeatureBbox | undefined

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--tile') {
      const value = argv[index + 1]
      if (!value) throw new Error('--tile requires a value like N59/E18')
      onlyTile = parseDegreeTilePrefix(value)
      index += 1
      continue
    }
    if (arg.startsWith('--tile=')) {
      onlyTile = parseDegreeTilePrefix(arg.slice('--tile='.length))
      continue
    }
    if (arg === '--bbox') {
      const value = argv[index + 1]
      if (!value) throw new Error('--bbox requires west,south,east,north')
      bbox = parseBbox(value)
      index += 1
      continue
    }
    if (arg.startsWith('--bbox=')) {
      bbox = parseBbox(arg.slice('--bbox='.length))
      continue
    }
    if (arg === '--europe') {
      bbox = EUROPE_GEO_FEATURE_BBOX
      continue
    }
    throw new Error(`Unknown argument "${arg}"`)
  }

  return { dryRun, onlyTile, bbox }
}

function rawFeatureCollection(
  features: RawFeature[],
): FeatureCollection<Geometry, Record<string, unknown>> {
  return {
    type: 'FeatureCollection',
    features,
  }
}

function tileMatches(tile: DegreeTile, onlyTile: DegreeTile | null): boolean {
  return !onlyTile || tile.prefix === onlyTile.prefix
}

function getTileBucket(
  tiles: Map<string, TileAccumulator>,
  tile: DegreeTile,
): TileAccumulator {
  const existing = tiles.get(tile.prefix)
  if (existing) return existing

  const created: TileAccumulator = {
    tile,
    rawGeoNames: [],
    highres: [],
    lowres: [],
  }
  tiles.set(tile.prefix, created)
  return created
}

function addFeatureToTiles<T extends Feature<Geometry>>(
  tiles: Map<string, TileAccumulator>,
  feature: T,
  onlyTile: DegreeTile | null,
  add: (bucket: TileAccumulator, feature: T) => void,
): void {
  for (const tile of degreeTilesForFeature(feature)) {
    if (!tileMatches(tile, onlyTile)) continue
    add(getTileBucket(tiles, tile), feature)
  }
}

function addFeaturesToTiles(
  tiles: Map<string, TileAccumulator>,
  features: {
    rawGeoNames: RawFeature[]
    highres: GeoFeature[]
    lowres: GeoFeature[]
  },
  onlyTile: DegreeTile | null,
): void {
  for (const feature of features.rawGeoNames) {
    addFeatureToTiles(tiles, feature, onlyTile, (bucket, item) =>
      bucket.rawGeoNames.push(item),
    )
  }
  for (const feature of features.highres) {
    addFeatureToTiles(tiles, feature, onlyTile, (bucket, item) =>
      bucket.highres.push(item),
    )
  }
  for (const feature of features.lowres) {
    addFeatureToTiles(tiles, feature, onlyTile, (bucket, item) =>
      bucket.lowres.push(item),
    )
  }
}

function gzipFeatureCollection(features: GeoFeature[]): Buffer {
  return gzipSync(JSON.stringify(featureCollection(mergeGeoFeatures(features))))
}

async function uploadObject(
  s3: S3Client,
  bucket: string,
  dryRun: boolean,
  key: string,
  body: string | Buffer,
  contentType: string,
  contentEncoding?: string,
): Promise<void> {
  const byteLength =
    typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength
  if (dryRun) {
    console.log(
      `[geo-features] dry-run ${key} (${byteLength.toLocaleString()} bytes)`,
    )
    return
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentEncoding: contentEncoding,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  )
  console.log(
    `[geo-features] uploaded s3://${bucket}/${key} (${byteLength.toLocaleString()} bytes)`,
  )
}

async function uploadTile(
  s3: S3Client,
  bucket: string,
  dryRun: boolean,
  tile: TileAccumulator,
): Promise<void> {
  const prefix = tile.tile.prefix

  if (tile.rawGeoNames.length > 0) {
    await uploadObject(
      s3,
      bucket,
      dryRun,
      `${prefix}/geonames.geojson`,
      JSON.stringify(rawFeatureCollection(tile.rawGeoNames)),
      'application/geo+json',
    )
  }

  await uploadObject(
    s3,
    bucket,
    dryRun,
    `${prefix}/v1/tiles/highres.json.gz`,
    gzipFeatureCollection(tile.highres),
    'application/geo+json',
    'gzip',
  )
  await uploadObject(
    s3,
    bucket,
    dryRun,
    `${prefix}/v1/tiles/lowres.json.gz`,
    gzipFeatureCollection(tile.lowres),
    'application/geo+json',
    'gzip',
  )
}

export async function buildGeoFeatures(
  options: BuildGeoFeaturesOptions = {},
): Promise<BuildGeoFeaturesResult> {
  const dryRun = options.dryRun ?? false
  const onlyTile = options.onlyTile ?? null
  const bbox = options.bbox
  const bucket = process.env.S3_BUCKET_GEOJSON?.trim()
  if (!bucket)
    throw new Error('Set S3_BUCKET_GEOJSON before running geo:features')

  console.log('[geo-features] loading GeoNames cities5000')
  const geoNames = await loadGeoNamesCities({ bbox })
  const lowresGeoNames = geoNames.normalized.filter(
    (feature) => (feature.properties.population ?? 0) >= 100_000,
  )

  const tiles = new Map<string, TileAccumulator>()
  addFeaturesToTiles(
    tiles,
    {
      rawGeoNames: geoNames.raw,
      highres: geoNames.normalized,
      lowres: lowresGeoNames,
    },
    onlyTile,
  )

  const s3 = new S3Client({
    region:
      process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
  })
  const sortedTiles = Array.from(tiles.values()).sort((a, b) =>
    a.tile.prefix.localeCompare(b.tile.prefix),
  )

  console.log(
    `[geo-features] writing ${sortedTiles.length.toLocaleString()} tile folders`,
  )
  for (const tile of sortedTiles) {
    await uploadTile(s3, bucket, dryRun, tile)
  }

  return {
    bbox,
    tilesWritten: sortedTiles.length,
    rawGeoNames: geoNames.raw.length,
    highres: geoNames.normalized.length,
    lowres: lowresGeoNames.length,
  }
}

async function main(): Promise<void> {
  await buildGeoFeatures(parseArgs(process.argv.slice(2)))
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
