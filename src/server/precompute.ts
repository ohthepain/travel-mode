import { bbox, buffer, lineString } from '@turf/turf'
import type { LineString, Polygon } from 'geojson'

const BUFFER_KM = 300

export function buildCorridorAndBbox(coords: [number, number][]) {
  if (coords.length < 2) return { corridor: null as Polygon | null, bbox: null as [number, number, number, number] | null }
  const line = lineString(coords)
  const buffered = buffer(line, BUFFER_KM, { units: 'kilometers' })
  if (buffered.geometry.type !== 'Polygon') {
    return { corridor: null, bbox: null }
  }
  const b = bbox(buffered)
  return {
    corridor: buffered.geometry,
    bbox: b as [number, number, number, number],
  }
}

export function lineFromCoords(coords: [number, number][]): LineString {
  return { type: 'LineString', coordinates: coords }
}
