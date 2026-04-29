import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Airport } from '#/lib/airports-data'
import {
  airportsFromOurAirportsCsv,
  airportsToJsonBlob,
} from '#/lib/airports-csv'
import { ensureAirportsLoaded, airportsList } from '#/lib/airports-client'

export const Route = createFileRoute('/_main/admin/airports')({
  component: AirportsAdminPage,
})

function AirportsAdminPage() {
  const [imported, setImported] = useState<Airport[] | null>(null)
  const [bundled, setBundled] = useState<Airport[] | null>(null)
  const [bundleErr, setBundleErr] = useState<string | null>(null)
  const [parseErr, setParseErr] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const loadBundled = useCallback(async () => {
    setBundleErr(null)
    try {
      await ensureAirportsLoaded()
      setBundled([...airportsList])
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
        const rows = airportsFromOurAirportsCsv(text)
        setImported(rows)
      } catch (e) {
        setParseErr(e instanceof Error ? e.message : 'Could not parse CSV')
      }
    }
    reader.onerror = () => setParseErr('Could not read file')
    reader.readAsText(file, 'UTF-8')
  }, [])

  const shown = imported ?? bundled ?? []
  const headerNote = imported
    ? `Preview from ${fileName ?? 'CSV'} (${shown.length} airports)`
    : `Airports in public bundle (${shown.length})`

  const downloadHref = useMemo(() => {
    if (!imported?.length) return null
    return URL.createObjectURL(airportsToJsonBlob(imported))
  }, [imported])

  useEffect(() => {
    return () => {
      if (downloadHref) URL.revokeObjectURL(downloadHref)
    }
  }, [downloadHref])

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
          Commit the downloaded file as{' '}
          <code className="rounded bg-[var(--chip-bg)] px-1.5 py-0.5 text-xs">
            public/data/airports.json
          </code>{' '}
          (served at <code className="text-xs">/data/airports.json</code>). The app caches it in
          IndexedDB after the first successful fetch.
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
          {imported && imported.length > 0 && downloadHref ? (
            <a
              href={downloadHref}
              download="airports.json"
              className="rounded-lg border border-[var(--sea-accent)] bg-[var(--sea-accent)]/10 px-4 py-2 text-sm font-medium text-[var(--sea-accent)] no-underline"
            >
              Download airports.json
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

        <div className="max-h-[min(28rem,55vh)] overflow-auto rounded-lg border border-[var(--line)]">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-[var(--header-bg)]">
              <tr className="border-b border-[var(--line)]">
                <th className="px-2 py-2 font-medium text-[var(--sea-ink)]">IATA</th>
                <th className="px-2 py-2 font-medium text-[var(--sea-ink)]">Type</th>
                <th className="px-2 py-2 font-medium text-[var(--sea-ink)]">Display</th>
                <th className="px-2 py-2 font-medium text-[var(--sea-ink)]">City</th>
                <th className="px-2 py-2 font-medium text-[var(--sea-ink)]">Country</th>
                <th className="px-2 py-2 font-medium text-[var(--sea-ink)]">Lat</th>
                <th className="px-2 py-2 font-medium text-[var(--sea-ink)]">Lon</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr
                  key={a.iata}
                  className="border-b border-[var(--line)]/80 odd:bg-[var(--header-bg)]/40"
                >
                  <td className="px-2 py-1.5 font-mono text-xs">{a.iata}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{a.airportType}</td>
                  <td className="px-2 py-1.5 text-[var(--sea-ink-soft)]">{a.displayName}</td>
                  <td className="px-2 py-1.5 text-[var(--sea-ink-soft)]">{a.city}</td>
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
          ) : null}
        </div>
      </section>
    </main>
  )
}
