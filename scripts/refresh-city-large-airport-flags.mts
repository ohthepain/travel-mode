/**
 * Resyncs `public/data/cities.json` `hasLargeAirport` from `airports.json`.
 * The app also reapplies flags in `#/lib/buildLocationSearchDocs` when airports + cities load.
 *
 *   node --import tsx ./scripts/refresh-city-large-airport-flags.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyLargeAirportFlagsToCities } from '../src/lib/catalog-cities-large.ts'
import type { CatalogAirport, CatalogCity } from '../src/lib/flight-data.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function main(): void {
  const airports = JSON.parse(
    readFileSync(join(root, 'public/data/airports.json'), 'utf8'),
  ) as CatalogAirport[]
  const cities = JSON.parse(
    readFileSync(join(root, 'public/data/cities.json'), 'utf8'),
  ) as CatalogCity[]

  const next = applyLargeAirportFlagsToCities(airports, cities)

  writeFileSync(
    join(root, 'public/data/cities.json'),
    `${JSON.stringify(next, null, 2)}\n`,
    'utf8',
  )

  const withLarge = next.filter((c) => c.hasLargeAirport).length
  console.log(`[refresh] cities: ${next.length}, hasLargeAirport true: ${withLarge}`)
}

main()
