import type { Feature, FeatureCollection, LineString } from 'geojson'
import type { Track } from '../../generated/prisma/client'

function msForJson(v: bigint | number | null | undefined): number | null {
  if (v == null) return null
  if (typeof v === 'bigint') return Number(v)
  return v
}

function isLineString(g: unknown): g is LineString {
  if (typeof g !== 'object' || g == null) return false
  const o = g as { type?: string; coordinates?: unknown }
  return o.type === 'LineString' && Array.isArray(o.coordinates)
}

export function trackToGeoFeature(track: Track): Feature<LineString> {
  const geom = track.routeGeojson
  if (!isLineString(geom)) {
    throw new Error('track.routeGeojson is not a LineString')
  }
  return {
    type: 'Feature',
    geometry: geom,
    properties: {
      id: track.id,
      flightNumber: track.flightNumber,
      travelDate: track.travelDate.toISOString().slice(0, 10),
      fr24FlightId: track.fr24FlightId,
      firstTimestampMs: msForJson(track.firstTimestampMs),
      lastTimestampMs: msForJson(track.lastTimestampMs),
      fetchedAt: track.fetchedAt.toISOString(),
      originIata: track.originIata,
      destIata: track.destIata,
      originIcao: track.originIcao,
      destIcao: track.destIcao,
      takeoffAt: track.takeoffAt?.toISOString() ?? null,
      landedAt: track.landedAt?.toISOString() ?? null,
      scheduledDeparture: track.scheduledDeparture?.toISOString() ?? null,
      scheduledArrival: track.scheduledArrival?.toISOString() ?? null,
      flightTimeSec: track.flightTimeSec,
      scheduleJson: track.scheduleJson,
    },
  }
}

export function featureCollection(tracks: Track[]): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: tracks.map(trackToGeoFeature),
  }
}
