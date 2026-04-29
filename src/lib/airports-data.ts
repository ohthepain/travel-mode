/**
 * Re-export: canonical shape is {@link CatalogAirport} in `./flight-data`.
 * Kept as `Airport` here so catalog loaders (`airports-client`, IDB) stay readable.
 */
export type { CatalogAirport as Airport } from './flight-data'
