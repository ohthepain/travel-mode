/// <reference types="vite/client" />

declare module '@flightradar24/fr24sdk' {
  const SDK: { Client: new (opts: { apiToken?: string; apiVersion?: string }) => unknown }
  export default SDK
}

interface ImportMetaEnv {
  readonly VITE_MAPTILER_KEY: string
  /** Optional: public https origin when testing OAuth via a tunnel (must match Google redirect URIs). */
  readonly VITE_PUBLIC_APP_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
