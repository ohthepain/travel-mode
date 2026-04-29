/** Optional `public/data/air-to-city-code.json` (airport IATA → city code). Loaded once per session. */

let merged: Record<string, string> = {}
let loaded: Promise<void> | null = null

export async function ensureAirToCityOverridesLoaded(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const r = await fetch('/data/air-to-city-code.json', { cache: 'no-cache' })
        if (!r.ok) return
        const j = (await r.json()) as unknown
        if (j && typeof j === 'object') {
          merged = { ...merged, ...(j as Record<string, string>) }
        }
      } catch {
        /* ignore missing / parse errors */
      }
    })()
  }
  return loaded
}

export function airToCityOverrideMap(): Record<string, string> {
  return merged
}
