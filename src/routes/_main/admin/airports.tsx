import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AirportAutocompleteInput } from '#/components/AirportAutocompleteInput'
import type { LocationSelection } from '#/components/AirportAutocompleteInput'
import type { Airport } from '#/lib/airports-data'
import { airportsList, ensureAirportsLoaded } from '#/lib/airports-client'
import { citiesList, ensureCitiesLoaded } from '#/lib/cities-client'
import {
  airportsFromOurAirportsCsv,
  airportsToJsonBlob,
  citiesToJsonBlob,
} from '#/lib/airports-csv'
import { countriesByCode, ensureCountriesLoaded } from '#/lib/countries-client'
import type { CatalogCity } from '#/lib/flight-data'
import { buildLocationSearchDocs } from '#/lib/location-autocomplete'
import type { LocationSearchDoc } from '#/lib/location-autocomplete'

export const Route = createFileRoute('/_main/admin/airports')({
  component: AirportsAdminPage,
})

function filterAirportsByLocation(
  rows: Airport[],
  sel: LocationSelection | null,
): Airport[] {
  if (!sel) return rows
  const code = sel.code.trim().toUpperCase()
  if (sel.kind === 'airport') return rows.filter((a) => a.iata === code)
  return rows.filter((a) => a.cityCode === code)
}

function AirportsAdminPage() {
  const [imported, setImported] = useState<{
    airports: Airport[]
    cities: CatalogCity[]
  } | null>(null)
  const [bundled, setBundled] = useState<Airport[] | null>(null)
  const [bundleErr, setBundleErr] = useState<string | null>(null)
  const [parseErr, setParseErr] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [filterSel, setFilterSel] = useState<LocationSelection | null>(null)
  const [locationDocs, setLocationDocs] = useState<LocationSearchDoc[]>([])

  useEffect(() => {
    void Promise.all([
      ensureCountriesLoaded(),
      ensureAirportsLoaded(),
      ensureCitiesLoaded(),
    ]).then(() => {
      setLocationDocs(
        buildLocationSearchDocs(
          [...airportsList],
          [...citiesList],
          countriesByCode,
        ),
      )
    })
  }, [])

  const loadBundled = useCallback(async () => {
    setBundleErr(null)
    try {
      await ensureAirportsLoaded()
      setBundled([...airportsList])
      setLocationDocs(
        buildLocationSearchDocs(
          [...airportsList],
          [...citiesList],
          countriesByCode,
        ),
      )
    } catch (e) {
      setBundleErr(e instanceof Error ? e.message : 'Failed to load bundle')
      setBundled(null)
    }
  }, [])

  useEffect(() => {
    void loadBundled()
  }, [loadBundled])

  const onFile = useCallback((file: File | null) => {
    setParseErr(null)
    setImported(null)
    setFileName(null)
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text =
          typeof reader.result === 'string'
            ? reader.result
            : new TextDecoder().decode(reader.result as ArrayBuffer)
        const { airports, cities } = airportsFromOurAirportsCsv(text)
        setImported({ airports, cities })
      } catch (e) {
        setParseErr(e instanceof Error ? e.message : 'Could not parse CSV')
      }
    }
    reader.onerror = () => setParseErr('Could not read file')
    reader.readAsText(file, 'UTF-8')
  }, [])

  const shown = imported?.airports ?? bundled ?? []
  const displayed = useMemo(
    () => filterAirportsByLocation(shown, filterSel),
    [shown, filterSel],
  )
  const headerNote = imported
    ? `Preview from ${fileName ?? 'CSV'} (${shown.length} airports${filterSel ? `, ${displayed.length} match filter` : ''})`
    : `Airports in public bundle (${shown.length}${filterSel ? `, ${displayed.length} shown` : ''})`

  const downloadAirportsHref = useMemo(() => {
    if (!imported?.airports.length) return null
    return URL.createObjectURL(airportsToJsonBlob(imported.airports))
  }, [imported])

  const downloadCitiesHref = useMemo(() => {
    if (!imported?.cities.length) return null
    return URL.createObjectURL(citiesToJsonBlob(imported.cities))
  }, [imported])

  useEffect(() => {
    return () => {
      if (downloadAirportsHref) URL.revokeObjectURL(downloadAirportsHref)
      if (downloadCitiesHref) URL.revokeObjectURL(downloadCitiesHref)
    }
  }, [downloadAirportsHref, downloadCitiesHref])

  return (
    <main className="page-wrap px-4 py-8">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">Admin</p>
        <h1 className="display-title mb-2 text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
          Airports
        </h1>
        <p className="m-0 mb-4 text-sm text-[var(--sea-ink-soft)]">
          <Link
            to="/admin"
            className="text-[var(--sea-accent)] font-medium underline decoration-[var(--sea-accent)]/50 underline-offset-2 hover:decoration-[var(--sea-accent)]"
          >
            ← Admin
          </Link>
        </p>

        <p className="m-0 mb-4 max-w-2xl text-sm leading-6 text-[var(--sea-ink-soft)]">
          Import the OurAirports{' '}
          <code className="rounded bg-[var(--chip-bg)] px-1.5 py-0.5 text-xs">
            airports.csv
          </code>{' '}
          export. Only rows with a 3-letter IATA code and allowed facility types are kept.
          Commit the downloaded files as{' '}
          <code className="rounded bg-[var(--chip-bg)] px-1.5 py-0.5 text-xs">
            public/data/airports.json
          </code>{' '}
          and{' '}
          <code className="rounded bg-[var(--chip-bg)] px-1.5 py-0.5 text-xs">
            public/data/cities.json
          </code>{' '}
          (served at <code className="text-xs">/data/…</code>). The app caches them in IndexedDB
          after the first successful fetch.
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer flex-col gap-1 text-sm text-[var(--sea-ink)]">
            <span>Import CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="max-w-full cursor-pointer text-xs file:mr-3 file:rounded-lg file:border file:border-[var(--line)] file:bg-[var(--header-bg)] file:px-3 file:py-2 file:text-sm"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            onClick={() => void loadBundled()}
            className="rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 py-2 text-sm font-medium text-[var(--sea-ink)]"
          >
            Reload bundle
          </button>
          {imported && imported.airports.length > 0 && downloadAirportsHref ? (
            <a
              href={downloadAirportsHref}
              download="airports.json"
              className="rounded-lg border border-[var(--sea-accent)] bg-[var(--sea-accent)]/10 px-4 py-2 text-sm font-medium text-[var(--sea-accent)] no-underline"
            >
              Download airports.json
            </a>
          ) : null}
          {imported && imported.cities.length > 0 && downloadCitiesHref ? (
            <a
              href={downloadCitiesHref}
              download="cities.json"
              className="rounded-lg border border-[var(--sea-accent)] bg-[var(--sea-accent)]/10 px-4 py-2 text-sm font-medium text-[var(--sea-accent)] no-underline"
            >
              Download cities.json
            </a>
          ) : null}
        </div>

        {parseErr ? (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
            {parseErr}
          </p>
        ) : null}
        {bundleErr ? (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
            {bundleErr}
          </p>
        ) : null}

        <p className="mb-2 text-sm font-medium text-[var(--sea-ink)]">{headerNote}</p>

        <label className="mb-4 flex max-w-xl flex-col gap-1.5 text-sm font-medium text-[var(--sea-ink)]">
          Filter table (same catalog as flight search)
          <div className="flex flex-wrap items-center gap-2">
            <AirportAutocompleteInput
              valueSelection={filterSel}
              onChangeSelection={setFilterSel}
              docs={locationDocs}
              placeholder="City or airport…"
              ariaLabel="Filter airports by location"
              className="max-w-md"
            />
            {filterSel ? (
              <button
                type="button"
                onClick={() => setFilterSel(null)}
                className="rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 text-xs font-medium text-[var(--sea-ink)]"
              >
                Clear filter
              </button>
            ) : null}
          </div>
        </label>

        <div className="max-h-[min(28rem,55vh)] overflow-auto rounded-lg border border-[var(--line)]">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-[var(--header-bg)]">
              <tr className="border-b border-[var(--line)]">
                <th className="px-2 py-2 font-medium text-[var(--sea-ink)]">IATA</th>
                <th className="px-2 py-2 font-medium text-[var(--sea-ink)]">Type</th>
                <th className="px-2 py-2 font-medium text-[var(--sea-ink)]">Display</th>
                <th className="px-2 py-2 font-medium text-[var(--sea-ink)]">City code</th>
                <th className="px-2 py-2 font-medium text-[var(--sea-ink)]">Country</th>
                <th className="px-2 py-2 font-medium text-[var(--sea-ink)]">Lat</th>
                <th className="px-2 py-2 font-medium text-[var(--sea-ink)]">Lon</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((a) => (
                <tr
                  key={a.iata}
                  className="border-b border-[var(--line)]/80 odd:bg-[var(--header-bg)]/40"
                >
                  <td className="px-2 py-1.5 font-mono text-xs">{a.iata}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{a.airportType}</td>
                  <td className="px-2 py-1.5 text-[var(--sea-ink-soft)]">{a.displayName}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{a.cityCode}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{a.country}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{a.lat.toFixed(4)}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{a.lon.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 ? (
            <p className="m-0 px-3 py-6 text-center text-sm text-[var(--sea-ink-soft)]">
              No airports yet. Drop a CSV above or add{' '}
              <code className="text-xs">public/data/airports.json</code>.
            </p>
          ) : displayed.length === 0 ? (
            <p className="m-0 px-3 py-6 text-center text-sm text-[var(--sea-ink-soft)]">
              No airports match this filter. Clear or pick another airport or city.
            </p>
          ) : null}
        </div>
      </section>
    </main>
  )
}
