import type { Job } from 'pg-boss'
import {
  buildGeoFeatures,
  EUROPE_GEO_FEATURE_BBOX,
} from '../geo-features/build'
import type {
  BuildGeoFeaturesOptions,
  BuildGeoFeaturesResult,
} from '../geo-features/build'
import type { GeoFeatureBbox } from '../geo-features/sources'

export const BUILD_GEO_FEATURES_QUEUE = 'build_geo_features'

export type BuildGeoFeaturesPayload = {
  bbox?: GeoFeatureBbox
  dryRun?: boolean
  sources?: {
    geonames?: boolean
    naturalearth?: boolean
  }
}

function buildOptionsFromPayload(
  payload: BuildGeoFeaturesPayload,
): BuildGeoFeaturesOptions {
  if (payload.sources?.naturalearth) {
    throw new Error('build_geo_features currently supports GeoNames only')
  }
  if (payload.sources?.geonames === false) {
    throw new Error('build_geo_features requires GeoNames to be enabled')
  }

  return {
    bbox: payload.bbox ?? EUROPE_GEO_FEATURE_BBOX,
    dryRun: payload.dryRun ?? false,
  }
}

export async function buildGeoFeaturesJob(
  payload: BuildGeoFeaturesPayload = {},
): Promise<BuildGeoFeaturesResult> {
  return buildGeoFeatures(buildOptionsFromPayload(payload))
}

export async function handleBuildGeoFeaturesBatches(
  jobs: Job<BuildGeoFeaturesPayload>[],
): Promise<BuildGeoFeaturesResult[]> {
  const results: BuildGeoFeaturesResult[] = []
  for (const job of jobs) {
    results.push(await buildGeoFeaturesJob(job.data))
  }
  return results
}
