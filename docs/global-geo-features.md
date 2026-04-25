# Global geo features

Travelmode builds global map features into one-degree folders in S3. A point at
`lon=18.06`, `lat=59.33` is stored under `N59/E18`; the integer tile id is
`59_18`.

## S3 layout

```text
N59/E18/geonames.geojson
N59/E18/v1/tiles/highres.json.gz
N59/E18/v1/tiles/lowres.json.gz
```

The source files are per-source GeoJSON subsets. The versioned tile files are
deduped, normalized, filtered, merged, and gzip-compressed GeoJSON feature
collections.

The app fetches the versioned tile files through `/api/geo-features/...`, then
stores the parsed GeoJSON in IndexedDB by one-degree tile and resolution.
Flight-path cells use `highres`; other cells in the saved map bbox use `lowres`.

Normalized feature properties look like:

```json
{
  "id": "geonames:2673730",
  "name": "Stockholm",
  "category": "city",
  "importance": 92,
  "population": 975000,
  "sources": ["geonames"],
  "sourceIds": ["geonames:2673730"],
  "wikidataId": "Q1754"
}
```

## Building

Set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `S3_BUCKET_GEOJSON` in
your environment, then run:

```sh
pnpm geo:features
```

For a safe single-tile preview:

```sh
pnpm geo:features -- --dry-run --tile=N59/E18
```

To build only the current Europe coverage area from GeoNames:

```sh
pnpm geo:features -- --europe
```

The same Europe build can be queued through pg-boss from `/admin/pgboss`
(`build_geo_features`). It uses `west=-9`, `south=35`, `east=40`, `north=72`
and intentionally enables GeoNames only.

The first version pulls GeoNames `cities5000.zip` from the GeoNames dump
service. Highres includes all GeoNames cities; lowres includes GeoNames cities
with population at least 100,000. Natural Earth should be built by a separate
job later, then merged into the versioned tile outputs.
