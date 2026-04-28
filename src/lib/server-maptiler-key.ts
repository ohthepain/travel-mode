import 'dotenv/config'

/** Server-only: MapTiler key for proxied fetches. Same lookup as the raster tile route. */
export function getMapTilerApiKeyFromEnv(): string {
  return (
    process.env.VITE_MAPTILER_API_KEY?.trim() ||
    process.env.MAPTILER_API_KEY?.trim() ||
    process.env.VITE_MAPTILER_KEY?.trim() ||
    String(import.meta.env.VITE_MAPTILER_API_KEY ?? '').trim()
  )
}
