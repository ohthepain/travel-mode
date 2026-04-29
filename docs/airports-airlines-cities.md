# Airports, Airlines and Cities for auto-complete

We store data for airports, airlines, countries, and (later) cities for auto-complete.  
Data is JSON under `public/data/` and is loaded at runtime.  
Each catalog is cached in **IndexedDB** after the first successful fetch (see `#/lib/*-idb`).  
We don’t use Typesense yet; plan is **Flexsearch** over these lists.

**Flight search** (`/my-flights/search`) preloads **airlines** and **countries** in the background so maps and autocomplete can use them without extra wiring.

## Airports

- **Source:** [OurAirports `airports.csv`](https://davidmegginson.github.io/ourairports-data/airports.csv)
- **Admin:** `/admin/airports` — import CSV, preview, download JSON
- **Bundle:** `public/data/airports.json` → URL `/data/airports.json`
- **Client:** `#/lib/airports-client` (`airportsByIata`, `airportsList`, `ensureAirportsLoaded`)

## Airlines

- **Source:** [OpenFlights `airlines.dat`](https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat) (CSV with quoted fields; `\N` = null in the raw dump)
- **Logical header (for documentation only; the shipped file usually has no header row):**  
  `AirlineID,Name,Alias,IATA,ICAO,Callsign,Country,Active`
- **Admin:** `/admin/airlines` — import `airlines.dat`, preview, download JSON. If the first row’s first column is `AirlineID`, it is treated as a header and skipped.
- **Bundle:** `public/data/airlines.json` → URL `/data/airlines.json`
- **Client:** `#/lib/airlines-client` (`airlinesByIata`, `airlinesList`, `ensureAirlinesLoaded`)
- **TypeScript shape:** `Airline` in `#/lib/airlines-data` — `{ iata, name, country }` with **country** as ISO 3166-1 alpha-2 (`"SE"`, `"US"`, …).

### Airline normalization rules

- Keep only rows where **`Active`** is **`Y`** (case-insensitive).
- Trim fields; treat **`\N`** and blanks as empty; collapse repeated whitespace in names.
- Require a valid **2-character IATA** `[A–Z0–9]` (uppercased). ICAO-only carriers are omitted.
- **Country:** English country string from OpenFlights is mapped to **ISO alpha-2** via `#/lib/openflights-country-to-iso` (extend the map if a country string is missing). Rows with no mapping are dropped. Strings that are already two letters are accepted as ISO when they match `[A-Z]{2}`.
- **Dedupe:** one row per **IATA**; on duplicates prefer a row with resolved country and extra ICAO data in the source, then lower **`AirlineID`**.
- Output JSON contains only **`iata`**, **`name`**, and **`country`** (ISO).

IndexedDB for airlines was bumped to **version 2** when this schema replaced the wider catalog shape; existing airline cache entries are cleared on upgrade.

## Countries

- **Source:** GeoNames **`countryInfo.txt`** (same column layout as documented in the file; tab-separated, `#` comment lines).
- **Admin:** `/admin/countries` — import `countryNames.txt` / `countryInfo.txt`, preview, download JSON.
- **Bundle:** `public/data/countries.json` → URL `/data/countries.json`
- **Client:** `#/lib/countries-client` (`countriesByCode`, `countriesList`, `ensureCountriesLoaded`)
- **TypeScript shape:** `Country` in `#/lib/countries-data` —  
  `{ code, iso3, numeric, name, capital, continent, currency, phone, languages }`  
  (**`phone`** is normalized with a `+` prefix when the source is digits only; **`languages`** are comma-split BCP 47 tags from the source.)

### Country parsing

- Skip lines that start with `#`, except the column header line `#ISO\tISO3\t...`, which is ignored.
- Expect fixed tab column order through at least the **Languages** field (see `#/lib/countries-tsv`).

## Cities

- **Shape:** `CatalogCity` in `#/lib/flight-data` — `{ code, name, countryCode }` (bundled autocomplete; optional coordinates are only on schedule/API `City` rows).
- **Admin:** `/admin/airports` CSV import produces **`cities.json`** alongside `airports.json` (vote city display names from OurAirports municipalities per resolved city code).
- **Bundle:** `public/data/cities.json` → `/data/cities.json`
- **Overrides:** `public/data/air-to-city-code.json` merges on top of `#/lib/airport-metro-city-codes` via `#/lib/catalog-city-resolve`.
- **Client:** `#/lib/cities-client` + `#/lib/cities-idb` (same cache pattern as airports).
