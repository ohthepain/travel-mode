import 'dotenv/config'
import { GetObjectCommand, NoSuchKey, S3Client } from '@aws-sdk/client-s3'
import { Hono } from 'hono'

export const geoFeatureRoutes = new Hono()

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
})

function isTilePart(value: string, hemisphere: 'lat' | 'lon'): boolean {
  return hemisphere === 'lat'
    ? /^[NS]\d{1,2}$/.test(value)
    : /^[EW]\d{1,3}$/.test(value)
}

function isResolutionFile(value: string): value is 'highres.json.gz' | 'lowres.json.gz' {
  return value === 'highres.json.gz' || value === 'lowres.json.gz'
}

geoFeatureRoutes.get('/:lat/:lon/v1/tiles/:file', async (c) => {
  const bucket = process.env.S3_BUCKET_GEOJSON?.trim()
  if (!bucket) return c.text('Set S3_BUCKET_GEOJSON in .env', 503)

  const lat = c.req.param('lat')
  const lon = c.req.param('lon')
  const file = c.req.param('file')
  if (!isTilePart(lat, 'lat') || !isTilePart(lon, 'lon') || !isResolutionFile(file)) {
    return c.text('Invalid geo feature tile', 400)
  }

  const key = `${lat}/${lon}/v1/tiles/${file}`
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const bytes = await response.Body?.transformToByteArray()
    if (!bytes) return c.text('Missing geo feature tile body', 502)

    return new Response(new Uint8Array(bytes), {
      headers: {
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'Content-Type': response.ContentType ?? 'application/geo+json',
        'Content-Encoding': response.ContentEncoding ?? 'gzip',
      },
    })
  } catch (error) {
    if (
      error instanceof NoSuchKey ||
      (typeof error === 'object' &&
        error != null &&
        'name' in error &&
        (error as { name?: string }).name === 'NoSuchKey')
    ) {
      return c.text('Geo feature tile not found', 404)
    }
    console.warn('[geo-features] S3 error', key, error)
    return c.text('Upstream error', 502)
  }
})
