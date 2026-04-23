import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { Check, Loader2, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { authClient } from '../../../lib/auth-client'
import { MapPackStatusIndicator } from '../../../components/MapPackStatusIndicator'
import { cn } from '../../../lib/cn'

export const Route = createFileRoute('/_main/my-flights/search')({
  component: FlightSearchPage,
})

type SearchHit = {
  fr24FlightId: string
  flightNumber: string
  travelDate: string
  originIata: string | null
  destIata: string | null
  scheduledDeparture: string | null
  scheduledArrival: string | null
  takeoffAt: string | null
  landedAt: string | null
  syncStatus: { synced: boolean; jobActive: boolean }
}

/** Same meaning as server `flightAlreadySynced`: we have track data in the lookback window. */
export function flightAlreadySynced(hit: SearchHit): boolean {
  return hit.syncStatus.synced
}

function normalizeSearchHit(
  hit: Omit<SearchHit, 'syncStatus'> & { syncStatus?: SearchHit['syncStatus'] },
): SearchHit {
  return {
    ...hit,
    syncStatus: hit.syncStatus ?? { synced: false, jobActive: false },
  }
}

function hasFlightInfo(hit: SearchHit): boolean {
  return Boolean(
    hit.originIata &&
      hit.destIata &&
      (hit.scheduledDeparture ?? hit.takeoffAt),
  )
}

function todayUtcIso() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function FlightSearchPage() {
  const session = authClient.useSession()
  const [date, setDate] = useState(todayUtcIso)
  const [flightNumber, setFlightNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<SearchHit[] | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addedFr24Ids, setAddedFr24Ids] = useState(() => new Set<string>())

  const search = useCallback(async () => {
    const fn = flightNumber.trim().toUpperCase()
    if (!fn || !date) {
      setError('Enter a flight number and date.')
      return
    }
    setError(null)
    setLoading(true)
    setResults(null)
    try {
      const u = new URL('/api/flights/search', window.location.origin)
      u.searchParams.set('flightNumber', fn)
      u.searchParams.set('date', date)
      const r = await fetch(u)
      const text = await r.text()
      if (!r.ok) {
        let msg = text
        try {
          const j = JSON.parse(text) as { error?: string }
          if (j.error) msg = j.error
        } catch {
          /* use raw */
        }
        setError(msg)
        return
      }
      const j = JSON.parse(text) as {
        results?: Parameters<typeof normalizeSearchHit>[0][]
      }
      const list = Array.isArray(j.results) ? j.results : []
      setResults(list.map(normalizeSearchHit))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [date, flightNumber])

  const addFlight = useCallback(
    async (hit: SearchHit) => {
      if (!session.data?.user) {
        toast.error('Sign in to save flights')
        return
      }
      if (!hasFlightInfo(hit)) return
      setAddingId(hit.fr24FlightId)
      try {
        const r = await fetch('/api/flights/saved', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            flightNumber: hit.flightNumber,
            travelDate: hit.travelDate,
            fr24FlightId: hit.fr24FlightId,
            originIata: hit.originIata,
            destIata: hit.destIata,
            scheduledDeparture: hit.scheduledDeparture,
            scheduledArrival: hit.scheduledArrival,
            takeoffAt: hit.takeoffAt,
          }),
        })
        const text = await r.text()
        if (r.status === 409) {
          toast.message('Already on your list')
          setAddedFr24Ids((prev) => new Set(prev).add(hit.fr24FlightId))
          return
        }
        if (!r.ok) {
          let msg = text
          try {
            const j = JSON.parse(text) as { message?: string; error?: string }
            msg = j.message ?? j.error ?? msg
          } catch {
            /* */
          }
          toast.error(msg)
          return
        }
        toast.success(`Added ${hit.flightNumber}`)
        setAddedFr24Ids((prev) => new Set(prev).add(hit.fr24FlightId))
        setResults((prev) =>
          prev
            ? prev.map((h) =>
                h.fr24FlightId === hit.fr24FlightId
                  ? {
                      ...h,
                      syncStatus: { ...h.syncStatus, jobActive: true },
                    }
                  : h,
              )
            : null,
        )
      } finally {
        setAddingId(null)
      }
    },
    [session.data?.user],
  )

  return (
    <main className="mx-auto w-full max-w-lg px-3 pb-10 pt-6 sm:max-w-xl sm:px-4">
      <p className="mb-1">
        <Link
          to="/my-flights"
          className="text-sm font-medium text-cyan-600 no-underline hover:underline dark:text-cyan-400"
        >
          ← My flights
        </Link>
      </p>
      <h1 className="mt-0 mb-2 text-2xl font-semibold text-[var(--sea-ink)]">
        Add flight
      </h1>
      <p className="text-[var(--muted)] mb-6 text-sm">
        Search Flightradar24 for a flight on a given day, then save a leg to
        your list.
      </p>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-[var(--sea-ink)]">
          Date (UTC)
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 font-normal"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-[var(--sea-ink)]">
          Flight number
          <input
            value={flightNumber}
            onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
            placeholder="D84321"
            className="rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 font-mono font-normal tracking-wide"
          />
        </label>
      </div>

      <button
        type="button"
        disabled={loading}
        onClick={() => void search()}
        className={cn(
          'mb-6 rounded-lg px-4 py-2.5 text-sm font-semibold',
          'bg-cyan-600 text-slate-950 hover:bg-cyan-500',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {loading ? 'Searching…' : 'Search'}
      </button>

      {error && (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100">
          {error}
        </p>
      )}

      {results && results.length === 0 && !error && (
        <p className="text-[var(--muted)] text-sm">
          No flights found for that day and number. Try another date or operator
          code.
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {results.map((hit) => {
            const canOpen = hasFlightInfo(hit)
            const isAdded = addedFr24Ids.has(hit.fr24FlightId)
            const row = (
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-mono text-base font-bold tracking-wider text-[var(--sea-ink)]">
                    <MapPackStatusIndicator
                      flightNumber={hit.flightNumber}
                      travelDate={hit.travelDate}
                    />
                    {flightAlreadySynced(hit) ? (
                      <Check
                        className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                        aria-hidden
                      />
                    ) : hit.syncStatus.jobActive ? (
                      <Loader2
                        className="size-4 shrink-0 animate-spin text-cyan-600 dark:text-cyan-400"
                        aria-hidden
                      />
                    ) : (
                      <Timer
                        className="text-[var(--muted)] size-4 shrink-0"
                        aria-hidden
                      />
                    )}
                    <span>{hit.flightNumber}</span>
                  </p>
                  <p className="text-[var(--muted)] m-0 text-xs">
                    {hit.travelDate}
                    {hit.originIata && hit.destIata
                      ? ` · ${hit.originIata} → ${hit.destIata}`
                      : ''}
                  </p>
                  {(hit.scheduledDeparture || hit.takeoffAt) && (
                    <p className="text-[var(--muted)] m-0 mt-1 font-mono text-xs tabular-nums">
                      {new Date(
                        hit.scheduledDeparture ?? hit.takeoffAt ?? '',
                      ).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={
                    !session.data?.user ||
                    addingId === hit.fr24FlightId ||
                    !hasFlightInfo(hit) ||
                    isAdded
                  }
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void addFlight(hit)
                  }}
                  className={cn(
                    'shrink-0 rounded-lg border border-[var(--chip-line)] px-3 py-2 text-sm font-semibold',
                    'bg-[var(--sea-ink)] text-[var(--header-bg)] hover:opacity-90',
                    'disabled:cursor-not-allowed disabled:opacity-45',
                  )}
                >
                  {!hasFlightInfo(hit)
                    ? 'Waiting'
                    : addingId === hit.fr24FlightId
                      ? 'Adding…'
                      : isAdded
                        ? 'Added'
                        : 'Add'}
                </button>
              </div>
            )

            return (
              <li
                key={hit.fr24FlightId}
                className="rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] p-0"
              >
                {canOpen ? (
                  <Link
                    to="/flight/$flightNumber"
                    params={{
                      flightNumber: hit.flightNumber.replace(/\s+/g, ''),
                    }}
                    search={{ date: hit.travelDate }}
                    className={cn(
                      'block rounded-xl text-inherit no-underline',
                      'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500',
                    )}
                  >
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
