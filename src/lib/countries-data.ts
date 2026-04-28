/** GeoNames-style country row for client catalogs (from `countryInfo.txt` / `countryNames.txt`). */

export type Country = {
  /** ISO 3166-1 alpha-2 */
  code: string
  /** ISO 3166-1 alpha-3 */
  iso3: string
  /** ISO 3166-1 numeric */
  numeric: number
  name: string
  capital: string
  /** Continent code (e.g. EU, AS) */
  continent: string
  /** ISO 4217 currency code */
  currency: string
  /** E.164 country calling code, e.g. "+39" */
  phone: string
  /** BCP 47 tags from the source `Languages` column, split on commas */
  languages: string[]
}
