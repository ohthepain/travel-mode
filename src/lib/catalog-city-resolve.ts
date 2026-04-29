import { metroCityCodeOrAirportDefault } from './airport-metro-city-codes'
import type { IataCityCode } from './flight-data'

/**
 * Effective IATA city code for an airport catalog row — optional JSON overrides
 * (`public/data/air-to-city-code.json`, merged at load) win, then metro map,
 * then the airport code itself when it is not part of a known multi-airport city.
 */
export function resolveCatalogCityCode(
  airportIata: string,
  fileOverrides?: Record<string, string>,
): IataCityCode {
  const u = airportIata.trim().toUpperCase()
  if (!u) return u as IataCityCode
  const ovRaw = fileOverrides?.[u]?.trim().toUpperCase()
  const ov =
    ovRaw && /^[A-Z0-9]{3}$/.test(ovRaw) ? (ovRaw as IataCityCode) : undefined
  if (ov) return ov
  return metroCityCodeOrAirportDefault(u) as IataCityCode
}
