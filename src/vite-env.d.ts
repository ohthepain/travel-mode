/// <reference types="vite/client" />

declare module '@flightradar24/fr24sdk' {
  const SDK: { Client: new (opts: { apiToken?: string; apiVersion?: string }) => unknown }
  export default SDK
}

interface ImportMetaEnv {
  /** MapTiler Cloud API key; used by the server tile proxy only (`/api/map-tiles/...`). */
  readonly VITE_MAPTILER_API_KEY?: string
  /**
   * Optional MapTiler Cloud **custom** map id (same slug as in the style/tile URLs).
   * When set, the basemap picker includes “Custom …” and the tile/style proxies allow this id alongside presets.
   */
  readonly VITE_MAPTILER_RASTER_MAP_ID?: string
  /** Optional: public https origin when testing OAuth via a tunnel (must match Google redirect URIs). */
  readonly VITE_PUBLIC_APP_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
