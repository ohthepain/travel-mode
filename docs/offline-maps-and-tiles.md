# Offline maps: route, tiles, storage, and display

This document describes how Travelmode loads a flight **track (route)**, **downloads and caches** map tiles, **persists** them in the browser, **renders** the map, and **constrains** the view in offline mode so the basemap does not show empty **gray** placeholders.

## 1. Downloading the route

1. The UI loads track data with a `GET` request to  
   `/api/flights/{flightNumber}/tracks` (optional `?date=YYYY-MM-DD`).
2. The response is a GeoJSON `FeatureCollection` with a `meta` object. The store (`src/stores/flight.ts`) uses `setLineFromApi` to:
   - Pick the first **LineString** feature as the main route.
   - Read `meta.bbox` when present: `[west, south, east, north]` in degrees. That bbox is the preferred bounds for both tile pre‑fetch and offline pan limits.
3. If the API does not provide `meta.bbox`, the app can still derive bounds from the line’s coordinates (same min/max logic as in `downloadTiles` and `src/lib/line-bbox.ts` for display).

The **flight page** (`src/routes/_main/flight.$flightNumber.tsx`) passes `mapBbox` to the map as: API `bbox` if set, otherwise `bboxFromLineString(line)`.

## 2. Downloading the tiles

Tiles are not fetched from MapTiler in the browser. The app uses a **same-origin** URL so the key stays on the server and referrer restrictions do not break requests.

- **Client URL pattern**: `appMapTileUrlTemplate()` in `src/lib/tiles.ts` returns  
  `{origin}/api/map-tiles/{z}/{x}/{y}.png`.
- **Server** (`src/server/routes/map-tiles.ts`): Hono route `/map-tiles/:z/:x/:y` (mounted under the app’s API prefix) forwards to MapTiler’s raster template (`mapTilerRasterUrl` in `src/lib/tiles.ts`), using `MAPTILER_API_KEY` or `VITE_MAPTILER_KEY` from the environment.

**Which tiles to download** (`useFlightStore.downloadTiles` in `src/stores/flight.ts`):

- Bounding box: stored `bbox`, or if missing, a bbox computed from the LineString’s coordinates.
- **Zoom levels**: `Z_MIN = 3` through `Z_MAX = 8` (inclusive).
- For each `(z, x, y)` in that bbox, `tileRangeForBbox` in `src/lib/tiles.ts` enumerates the Web Mercator XYZ tile indices.
- Each tile is `fetch`ed from the app URL, then the response bytes are written to IndexedDB (see below). Progress is tracked as `done / total` for the UI.

`countTilesBbox` uses the same ranges to estimate total work before the loop.

## 3. Saving: IndexedDB

Database name: `travelmode-tiles` (see `src/lib/tile-idb.ts`).

| Store   | Key    | Purpose |
|--------|--------|--------|
| `tiles` | `"{z}/{x}/{y}"` | Raw PNG `ArrayBuffer` per tile, plus metadata. |
| `packs` | `"{FLIGHT_NUMBER}:{travelDate}"` | **Flight pack**: saved GeoJSON (`FeatureCollection`) and the **same bbox** used for tile coverage, for offline route + consistent bounds. |

`saveFlightPack` runs at the end of a successful `downloadTiles`, after all tiles in range are stored. A **pack** ties a flight + date to the route and bbox so `loadFlightPack` can restore the line and offline mode on return visits.

## 4. Displaying: online vs offline

**Component**: `src/components/FlightMap.tsx` (MapLibre).

### Basemap

- **Online** (`useOfflineRaster === false`): raster source with `appMapTileUrlTemplate()` so tiles load through your API proxy (live network).
- **Offline** (`useOfflineRaster === true`): a custom **protocol** `offtm` is registered. Tile URLs look like `offtm://{z}/{x}/{y}`. The handler parses `z, x, y`, calls `getTileData` from IndexedDB, and returns that buffer to MapLibre. If a tile is **not** in IDB, it returns a **synthetic 256×256 gray PNG** (`#52525b`) so MapLibre still gets an image (that is the **gray** you want to avoid showing at the edge of the map).

Raster layers use `tileSize: 256` and `maxzoom: 14` to match the proxy / MapTiler style.

### Route

The LineString is added as a GeoJSON source `route` and a `line` layer (teal stroke). `addOrUpdateRoute` updates or removes the source/layer when the line changes.

### Plane marker

When a position is available, an orange MapLibre `Marker` is placed at `plane` coordinates.

## 5. Limiting the view so the basemap stays off gray (offline)

Gray appears when MapLibre requests a tile that was **not** cached for the offline bbox. The fix is to keep the **visible viewport inside the bbox** for which tiles were downloaded, and to prevent zooming out so far that the viewport would extend past that area.

When **both** `useOfflineRaster` and a non-null `bbox` are set, `FlightMap`:

1. **`minZoomToContainViewportInBBox`** (`src/lib/map-bbox-clamp.ts`): Computes the most zoomed-out (smallest) zoom that still allows the current map size’s bounds to stay **fully inside** the saved bbox. That value becomes `map.setMinZoom(...)`, so the user cannot zoom out into “empty” margins beyond the data.
2. **`clampCenterToContainBBox`**: After pan/zoom, adjusts the **center** so that `getBounds()` remains inside the bbox. User intent is preserved via a ref (`userAnchorRef`) that tracks the desired center; the clamp nudges the map to satisfy the bbox (iterative correction).
3. **Input limits**: `scrollZoom`, `touchZoomRotate`, and `doubleClickZoom` are **disabled** in this mode so only intentional moves go through; `moveend` / `zoomend` / `resize` re-apply the clamp and min-zoom rule.

Together, this keeps the camera over the **tiled** region, so the `offtm` handler almost always finds real PNGs instead of the gray fallback.

**Note:** If the downloaded bbox and the set of zoom levels (3–8) still did not cover a given tile for some edge case, gray could still appear; the design assumes bbox + zoom list match what MapLibre requests for views strictly inside the bbox.

## File reference

| Concern | Location |
|--------|----------|
| Tile math (bbox → tiles) | `src/lib/tiles.ts` |
| LineString → bbox helper | `src/lib/line-bbox.ts` |
| IDB + packs | `src/lib/tile-idb.ts` |
| Download orchestration, bbox selection | `src/stores/flight.ts` |
| Map proxy to MapTiler | `src/server/routes/map-tiles.ts` |
| Map UI, `offtm`, gray fallback, pan/zoom limits | `src/components/FlightMap.tsx` |
| Bbox min-zoom + center clamp | `src/lib/map-bbox-clamp.ts` |
