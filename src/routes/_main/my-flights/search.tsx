import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { authClient } from '../../../lib/auth-client'
import { MapPackStatusIndicator } from '../../../components/MapPackStatusIndicator'
import { cn } from '../../../lib/cn'
import type { FlightSchedule } from '../../../lib/flight-data'

type MyFlightsSearchParams = {
  date?: string
  fn?: string
  from?: string
  to?: string
}

export const Route = createFileRoute('/_main/my-flights/search')({
  validateSearch: (search: Record<string, unknown>): MyFlightsSearchParams => {
    const date =
      typeof search.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.date)
        ? search.date
        : undefined
    const fn =
      typeof search.fn === 'string' && search.fn.trim() !== ''
        ? search.fn.trim().toUpperCase().replace(/\s+/g, '')
        : undefined
    const from =
      typeof search.from === 'string' && /^[A-Za-z]{3}$/.test(search.from)
        ? search.from.toUpperCase()
        : undefined
    const to =
      typeof search.to === 'string' && /^[A-Za-z]{3}$/.test(search.to)
        ? search.to.toUpperCase()
        : undefined
    return { date, fn, from, to }
  },
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

type ScheduleApiItem = FlightSchedule & {
  syncStatus: { synced: boolean; jobActive: boolean }
}

function scheduleRowToSearchHit(
  s: ScheduleApiItem,
  travelDate: string,
): SearchHit {
  const fn = s.flightNumber.replace(/\s+/g, '').toUpperCase()
  return {
    fr24FlightId: `al:${fn}:${s.departure.airport}:${s.arrival.airport}:${travelDate}`,
    flightNumber: s.flightNumber.replace(/\s+/g, '').toUpperCase(),
    travelDate,
    originIata: s.departure.airport,
    destIata: s.arrival.airport,
    scheduledDeparture: s.departure.time,
    scheduledArrival: s.arrival.time,
    takeoffAt: null,
    landedAt: null,
    syncStatus: s.syncStatus,
  }
}

/** Same meaning as server `flightAlreadySynced`: we have track data in the lookback window. */
export function flightAlreadySynced(hit: SearchHit): boolean {
  return hit.syncStatus.synced
}

function hasFlightInfo(hit: SearchHit): boolean {
  const dep =
    hit.scheduledDeparture?.trim() ||
    hit.takeoffAt?.trim() ||
    hit.scheduledArrival?.trim()
  return Boolean(hit.originIata && hit.destIata && dep)
}

function FlightSearchPage() {
  const session = authClient.useSession()
  const navigate = useNavigate()
  const urlSearch = Route.useSearch()
  const [date, setDate] = useState(() => urlSearch.date ?? '')
  const [flightNumber, setFlightNumber] = useState(() => urlSearch.fn ?? '')
  const [originIata, setOriginIata] = useState(() => urlSearch.from ?? '')
  const [destIata, setDestIata] = useState(() => urlSearch.to ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<SearchHit[] | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addedFr24Ids, setAddedFr24Ids] = useState(() => new Set<string>())
  const lastBootstrapKey = useRef<string | null>(null)

  const executeSearch = useCallback(
    async (overrides?: {
      date?: string
      flightNumber?: string
      originIata?: string
      destIata?: string
    }) => {
      const dateVal = (overrides?.date ?? date).trim()
      const fn = (overrides?.flightNumber ?? flightNumber).trim().toUpperCase()
      if (!fn) {
        setError('Enter a flight number.')
        return
      }
      setError(null)
      setLoading(true)
      setResults(null)
      try {
        const u = new URL('/api/flight-schedule', window.location.origin)
        u.searchParams.set('flightNumber', fn)
        if (dateVal) u.searchParams.set('date', dateVal)
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
        const j = JSON.parse(text) as { schedules?: ScheduleApiItem[] }
        const o = (overrides?.originIata ?? originIata).trim().toUpperCase()
        const d = (overrides?.destIata ?? destIata).trim().toUpperCase()
        const raw = Array.isArray(j.schedules) ? j.schedules : []
        const filtered = raw.filter((s) => {
          if (o && s.departure.airport.toUpperCase() !== o) return false
          if (d && s.arrival.airport.toUpperCase() !== d) return false
          return true
        })
        setResults(
          filtered.map((s) =>
            scheduleRowToSearchHit(s, s.departure.time.slice(0, 10)),
          ),
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed')
      } finally {
        setLoading(false)
      }
    },
    [date, flightNumber, destIata, originIata],
  )

  const signInReturnPath = useCallback(() => {
    const sp = new URLSearchParams()
    const dateParam = date.trim()
    if (dateParam) sp.set('date', dateParam)
    const fn = flightNumber.trim().toUpperCase().replace(/\s+/g, '')
    if (fn) sp.set('fn', fn)
    const o = originIata.trim().toUpperCase()
    if (o) sp.set('from', o)
    const dest = destIata.trim().toUpperCase()
    if (dest) sp.set('to', dest)
    return `/my-flights/search?${sp.toString()}`
  }, [date, flightNumber, originIata, destIata])

  useEffect(() => {
    const fn = urlSearch.fn?.trim()
    if (!fn) return
    const d = urlSearch.date ?? ''
    const key = `${d}|${fn}|${urlSearch.from ?? ''}|${urlSearch.to ?? ''}`
    if (lastBootstrapKey.current === key) return
    lastBootstrapKey.current = key
    setDate(d)
    setFlightNumber(fn)
    if (urlSearch.from) setOriginIata(urlSearch.from)
    if (urlSearch.to) setDestIata(urlSearch.to)
    void executeSearch({
      date: d,
      flightNumber: fn,
      originIata: urlSearch.from ?? '',
      destIata: urlSearch.to ?? '',
    })
  }, [urlSearch, executeSearch])

  const addFlight = useCallback(
    async (hit: SearchHit) => {
      if (!session.data?.user) return
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
            fr24FlightId: hit.fr24FlightId.startsWith('al:') ? null : hit.fr24FlightId,
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
      <h1 className="mt-0 mb-2 text-2xl font-semibold text-(--sea-ink)">
        Add flight
      </h1>
      <p className="text-(--muted) mb-6 text-sm">
        Look up timetable legs (AirLabs). Leave the date empty to list upcoming
        days from schedules and routes. Optional IATA origin and destination
        narrow to one route.
      </p>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-(--sea-ink)">
          Date (UTC, optional)
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-(--line) bg-(--chip-bg) px-3 py-2 font-normal"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-(--sea-ink)">
          Flight number
          <input
            value={flightNumber}
            onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
            placeholder="D84322 / NSZ4322"
            className="rounded-lg border border-(--line) bg-(--chip-bg) px-3 py-2 font-mono font-normal tracking-wide"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-(--sea-ink) sm:col-span-2">
          <span>Route (optional, IATA) — narrow to one origin → destination</span>
          <div className="mt-0 flex flex-wrap gap-2 sm:max-w-md">
            <input
              value={originIata}
              onChange={(e) =>
                setOriginIata(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z]/g, '')
                    .slice(0, 3),
                )
              }
              placeholder="NCE"
              className="min-w-0 flex-1 rounded-lg border border-(--line) bg-(--chip-bg) px-3 py-2 font-mono font-normal tracking-wide"
            />
            <span className="self-center text-(--muted)">→</span>
            <input
              value={destIata}
              onChange={(e) =>
                setDestIata(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z]/g, '')
                    .slice(0, 3),
                )
              }
              placeholder="ARN"
              className="min-w-0 flex-1 rounded-lg border border-(--line) bg-(--chip-bg) px-3 py-2 font-mono font-normal tracking-wide"
            />
          </div>
        </label>
      </div>

      <button
        type="button"
        disabled={loading}
        onClick={() => void executeSearch()}
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
        <div className="text-[var(--muted)] space-y-2 text-sm">
          <p className="m-0">
            No schedule rows for that search. Try another date (or clear it for
            all upcoming days), clear the route filter, or check the flight
            number.
          </p>
        </div>
      )}

      {results && results.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {results.map((hit) => {
            const canOpen = hasFlightInfo(hit)
            const isAdded = addedFr24Ids.has(hit.fr24FlightId)
            const rowMain = (
              <>
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
                      className="text-(--muted) size-4 shrink-0"
                      aria-hidden
                    />
                  )}
                  <span>{hit.flightNumber}</span>
                </p>
                <p className="text-(--muted) m-0 text-xs">
                  {hit.travelDate}
                  {hit.originIata && hit.destIata
                    ? ` · ${hit.originIata} → ${hit.destIata}`
                    : ''}
                </p>
                {(hit.scheduledDeparture || hit.takeoffAt) && (
                  <p className="text-(--muted) m-0 mt-1 font-mono text-xs tabular-nums">
                    {new Date(
                      hit.scheduledDeparture ?? hit.takeoffAt ?? '',
                    ).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                )}
              </>
            )
            const rowMainClass = cn(
              'min-w-0 flex-1 p-4',
              canOpen &&
                'rounded-l-xl hover:bg-black/3 dark:hover:bg-white/4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-500',
            )

            return (
              <li
                key={hit.fr24FlightId}
                className="flex flex-wrap items-stretch rounded-xl border border-(--line) bg-(--chip-bg) p-0"
              >
                {canOpen ? (
                  <Link
                    to="/flight/$flightNumber"
                    params={{
                      flightNumber: hit.flightNumber.replace(/\s+/g, ''),
                    }}
                    search={{ date: hit.travelDate }}
                    className={cn(
                      rowMainClass,
                      'text-inherit no-underline',
                    )}
                  >
                    {rowMain}
                  </Link>
                ) : (
                  <div className={rowMainClass}>{rowMain}</div>
                )}
                <div className="flex shrink-0 items-center p-4 pl-2 max-sm:grow max-sm:justify-end">
                  <button
                    type="button"
                    disabled={
                      addingId === hit.fr24FlightId ||
                      !hasFlightInfo(hit) ||
                      isAdded
                    }
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!session.data?.user) {
                        void navigate({
                          to: '/sign-in',
                          search: { redirect: signInReturnPath() },
                        })
                        return
                      }
                      void addFlight(hit)
                    }}
                    className={cn(
                      'shrink-0 rounded-lg border border-(--chip-line) px-3 py-2 text-sm font-semibold',
                      'bg-(--sea-ink) text-(--header-bg) hover:opacity-90',
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
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
