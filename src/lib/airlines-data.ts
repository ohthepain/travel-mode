/**
 * Re-export: canonical shape is {@link CatalogAirline} in `./flight-data`.
 * Kept as `Airline` here so catalog loaders (`airlines-client`, IDB) stay readable.
 */
export type { CatalogAirline as Airline } from './flight-data'
