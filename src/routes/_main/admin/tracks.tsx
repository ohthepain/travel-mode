import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useState } from 'react'

type TrackRow = {
  id: string
  flightNumber: string
  travelDate: string
  fr24FlightId: string
  fetchedAt: string
  firstTimestampMs: number | null
  lastTimestampMs: number | null
  originIata: string | null
  destIata: string | null
  takeoffAt: string | null
  landedAt: string | null
  scheduledDeparture: string | null
  scheduledArrival: string | null
}

type TracksResponse = { tracks: TrackRow[] }

export const Route = createFileRoute('/_main/admin/tracks')({
  component: TracksPage,
})

function TracksPage() {
  const [fn, setFn] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [rows, setRows] = useState<TrackRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const search = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const u = new URL('/api/admin/tracks', window.location.origin)
      if (fn.trim()) u.searchParams.set('flightNumber', fn.trim().toUpperCase())
      if (dateFrom) u.searchParams.set('dateFrom', dateFrom)
      if (dateTo) u.searchParams.set('dateTo', dateTo)
      const r = await fetch(u)
      if (!r.ok) {
        setErr(await r.text())
        setRows(null)
        return
      }
      const j = (await r.json()) as TracksResponse
      setRows(j.tracks)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Request failed')
      setRows(null)
    } finally {
      setLoading(false)
    }
  }, [fn, dateFrom, dateTo])

  return (
    <main className="page-wrap px-4 py-8">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">Admin</p>
        <h1 className="display-title mb-2 text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
          Tracks
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
          Filter by IATA-style flight number (partial match) and/or travel date range in
          UTC. Leave fields empty to match all. Results are limited to 200 rows.
        </p>

        <div className="mb-4 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-[var(--sea-ink)]">
            <span>Flight number</span>
            <input
              className="rounded-lg border border-[var(--line)] bg-[var(--header-bg)] px-3 py-2"
              value={fn}
              onChange={(e) => setFn(e.target.value.toUpperCase())}
              placeholder="e.g. D84321"
            />
          </label>
          <div className="hidden sm:block" />
          <label className="flex flex-col gap-1 text-sm text-[var(--sea-ink)]">
            <span>Travel date from (UTC)</span>
            <input
              type="date"
              className="rounded-lg border border-[var(--line)] bg-[var(--header-bg)] px-3 py-2"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-[var(--sea-ink)]">
            <span>Travel date to (UTC)</span>
            <input
              type="date"
              className="rounded-lg border border-[var(--line)] bg-[var(--header-bg)] px-3 py-2"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
        </div>

        <div className="mb-4">
          <button
            type="button"
            onClick={() => void search()}
            className="rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 py-2 text-sm font-medium text-[var(--sea-ink)]"
            disabled={loading}
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>

        {err && <p className="text-amber-700 dark:text-amber-200">{err}</p>}

        {rows && (
          <div className="max-w-full overflow-x-auto">
            <p className="mb-2 text-sm text-[var(--sea-ink-soft)]">
              {rows.length} track{rows.length === 1 ? '' : 's'}
            </p>
            <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--sea-ink-soft)]">
                  <th className="py-2 pr-3 font-medium">Flight</th>
                  <th className="py-2 pr-3 font-medium">Date (UTC)</th>
                  <th className="py-2 pr-3 font-medium">Route</th>
                  <th className="py-2 pr-3 font-medium">FR24 id</th>
                  <th className="py-2 pr-3 font-medium">Fetched</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-[var(--sea-ink-soft)]">
                      No tracks match.
                    </td>
                  </tr>
                )}
                {rows.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-[var(--line)]/60 text-[var(--sea-ink)]"
                  >
                    <td className="py-2 pr-3 align-top">{t.flightNumber}</td>
                    <td className="py-2 pr-3 align-top">{t.travelDate}</td>
                    <td className="whitespace-nowrap py-2 pr-3 align-top text-xs">
                      {t.originIata ?? '—'} → {t.destIata ?? '—'}
                    </td>
                    <td className="max-w-[10rem] truncate py-2 pr-3 align-top font-mono text-xs">
                      {t.fr24FlightId}
                    </td>
                    <td className="whitespace-nowrap py-2 align-top text-xs text-[var(--sea-ink-soft)]">
                      {t.fetchedAt}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
