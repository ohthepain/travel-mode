import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { authClient } from '../../../lib/auth-client'
import type { AirportSearchDoc } from '#/lib/airport-autocomplete'
import { buildAirportSearchDocs } from '#/lib/airport-autocomplete'
import { ensureAirlinesLoaded } from '#/lib/airlines-client'
import { airportsList, ensureAirportsLoaded } from '#/lib/airports-client'
import { ensureCountriesLoaded } from '#/lib/countries-client'
import { AirportAutocompleteInput } from '../../../components/AirportAutocompleteInput'
import { MapPackStatusIndicator } from '../../../components/MapPackStatusIndicator'
import { cn } from '../../../lib/cn'
import type { CatalogAirport, FlightSchedule } from '../../../lib/flight-data'

type MyFlightsSearchParams = {
  /** @deprecated use df/dt */
  date?: string
  df?: string
  dt?: string
  fn?: string
  from?: string
  to?: string
  page?: number
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

function parseYmd(v: unknown): string | undefined {
  return typeof v === 'string' && YMD.test(v) ? v : undefined
}

function utcTodayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function addUtcDays(ymd: string, delta: number): string {
  const d = new Date(ymd + 'T12:00:00.000Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** Inclusive UTC calendar range for the search query. */
function resolveSearchRange(
  dateFrom: string,
  dateTo: string,
): { start: string; end: string } {
  const hasFrom = Boolean(dateFrom.trim())
  const hasTo = Boolean(dateTo.trim())
  const today = utcTodayYmd()
  if (!hasFrom && !hasTo) {
    return { start: addUtcDays(today, -7), end: addUtcDays(today, 7) }
  }
  if (hasFrom && hasTo) {
    let a = dateFrom.trim()
    let b = dateTo.trim()
    if (a > b) [a, b] = [b, a]
    return { start: a, end: b }
  }
  if (hasFrom) {
    const s = dateFrom.trim()
    return { start: s, end: addUtcDays(s, 45) }
  }
  const e = dateTo.trim()
  return { start: addUtcDays(e, -45), end: e }
}

function* eachUtcDayInclusive(startYmd: string, endYmd: string): Generator<string> {
  let t = new Date(startYmd + 'T12:00:00.000Z').getTime()
  const end = new Date(endYmd + 'T12:00:00.000Z').getTime()
  const dayMs = 86400000
  while (t <= end) {
    yield new Date(t).toISOString().slice(0, 10)
    t += dayMs
  }
}

const RESULTS_PAGE_SIZE = 10

export const Route = createFileRoute('/_main/my-flights/search')({
  validateSearch: (search: Record<string, unknown>): MyFlightsSearchParams => {
    const legacyDate = parseYmd(search.date)
    let df = parseYmd(search.df)
    let dt = parseYmd(search.dt)
    if (legacyDate && !df && !dt) {
      df = legacyDate
      dt = legacyDate
    }
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
    const rawPage = search.page
    const page =
      typeof rawPage === 'number' && Number.isFinite(rawPage) && rawPage >= 1
        ? Math.floor(rawPage)
        : typeof rawPage === 'string' && /^\d+$/.test(rawPage)
          ? Math.max(1, parseInt(rawPage, 10))
          : 1
    return { df, dt, fn, from, to, page }
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

async function fetchFlightScheduleApi(params: {
  flightNumber?: string
  /** YYYY-MM-DD when using per-day lookups (no airport filter). */
  date?: string
  dep_iata?: string
  arr_iata?: string
}): Promise<ScheduleApiItem[]> {
  const u = new URL('/api/flight-schedule', window.location.origin)
  const fn = params.flightNumber?.trim()
  if (fn) u.searchParams.set('flightNumber', fn)
  if (params.date) u.searchParams.set('date', params.date)
  if (params.dep_iata) u.searchParams.set('dep_iata', params.dep_iata)
  if (params.arr_iata) u.searchParams.set('arr_iata', params.arr_iata)
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
    throw new Error(msg)
  }
  const j = JSON.parse(text) as { schedules?: ScheduleApiItem[] }
  return Array.isArray(j.schedules) ? j.schedules : []
}

function filterSchedulesByUtcYmdRange(
  rows: ScheduleApiItem[],
  startYmd: string,
  endYmd: string,
): ScheduleApiItem[] {
  return rows.filter((s) => {
    const ymd = s.departure.time.slice(0, 10)
    return ymd >= startYmd && ymd <= endYmd
  })
}

function FlightSearchPage() {
  const session = authClient.useSession()
  const navigate = useNavigate()
  const urlSearch = Route.useSearch()
  const [dateFrom, setDateFrom] = useState(() => urlSearch.df ?? '')
  const [dateTo, setDateTo] = useState(() => urlSearch.dt ?? '')
  const [flightNumber, setFlightNumber] = useState(() => urlSearch.fn ?? '')
  const [originIata, setOriginIata] = useState(() => urlSearch.from ?? '')
  const [destIata, setDestIata] = useState(() => urlSearch.to ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<SearchHit[] | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addedFr24Ids, setAddedFr24Ids] = useState(() => new Set<string>())
  const [airportDocs, setAirportDocs] = useState<AirportSearchDoc[]>([])
  const lastBootstrapKey = useRef<string | null>(null)

  useEffect(() => {
    void Promise.all([
      ensureAirlinesLoaded(),
      ensureCountriesLoaded(),
      ensureAirportsLoaded(),
    ]).then(() => {
      setAirportDocs(
        buildAirportSearchDocs([...airportsList] satisfies CatalogAirport[]),
      )
    })
  }, [])

  const executeSearch = useCallback(
    async (overrides?: {
      dateFrom?: string
      dateTo?: string
      flightNumber?: string
      originIata?: string
      destIata?: string
    }) => {
      const dfVal = (overrides?.dateFrom ?? dateFrom).trim()
      const dtVal = (overrides?.dateTo ?? dateTo).trim()
      const fn = (overrides?.flightNumber ?? flightNumber).trim().toUpperCase()
      const o = (overrides?.originIata ?? originIata).trim().toUpperCase()
      const d = (overrides?.destIata ?? destIata).trim().toUpperCase()
      if (!fn && !o && !d) {
        setError(
          'Enter a flight number, or pick at least one airport (from and/or to).',
        )
        return
      }
      setError(null)
      setLoading(true)
      setResults(null)
      try {
        await navigate({
          to: '/my-flights/search',
          replace: true,
          search: (prev) => ({
            ...prev,
            fn: fn || undefined,
            page: 1,
            df: dfVal || undefined,
            dt: dtVal || undefined,
            from: o || undefined,
            to: d || undefined,
          }),
        })
      } catch {
        /* noop */
      }
      try {
        const { start, end } = resolveSearchRange(dfVal, dtVal)

        /** AirLabs: `/flights` + `/schedules` by airport (`dep_iata` / `arr_iata`) when set. */
        if (o || d) {
          const raw = await fetchFlightScheduleApi({
            ...(fn ? { flightNumber: fn } : {}),
            ...(o ? { dep_iata: o } : {}),
            ...(d ? { arr_iata: d } : {}),
          })
          const inRange = filterSchedulesByUtcYmdRange(raw, start, end)
          inRange.sort((a, b) =>
            a.departure.time.localeCompare(b.departure.time),
          )
          setResults(
            inRange.map((s) =>
              scheduleRowToSearchHit(s, s.departure.time.slice(0, 10)),
            ),
          )
          return
        }

        if (!fn) {
          setError(
            'Enter a flight number to search by date without airport filters.',
          )
          return
        }

        const days = [...eachUtcDayInclusive(start, end)]
        const BATCH = 5
        const seen = new Set<string>()
        const merged: ScheduleApiItem[] = []
        for (let i = 0; i < days.length; i += BATCH) {
          const slice = days.slice(i, i + BATCH)
          const batches = await Promise.all(
            slice.map((ymd) =>
              fetchFlightScheduleApi({ flightNumber: fn, date: ymd }),
            ),
          )
          for (const batch of batches) {
            for (const s of batch) {
              const k = `${s.departure.time}|${s.departure.airport}|${s.arrival.airport}`
              if (seen.has(k)) continue
              seen.add(k)
              merged.push(s)
            }
          }
        }
        merged.sort((a, b) =>
          a.departure.time.localeCompare(b.departure.time),
        )
        setResults(
          merged.map((s) =>
            scheduleRowToSearchHit(s, s.departure.time.slice(0, 10)),
          ),
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed')
      } finally {
        setLoading(false)
      }
    },
    [
      dateFrom,
      dateTo,
      flightNumber,
      destIata,
      originIata,
      navigate,
    ],
  )

  const signInReturnPath = useCallback(() => {
    const sp = new URLSearchParams()
    const dfs = dateFrom.trim()
    const dts = dateTo.trim()
    if (dfs) sp.set('df', dfs)
    if (dts) sp.set('dt', dts)
    const fn = flightNumber.trim().toUpperCase().replace(/\s+/g, '')
    if (fn) sp.set('fn', fn)
    const o = originIata.trim().toUpperCase()
    if (o) sp.set('from', o)
    const dest = destIata.trim().toUpperCase()
    if (dest) sp.set('to', dest)
    return `/my-flights/search?${sp.toString()}`
  }, [dateFrom, dateTo, flightNumber, originIata, destIata])

  useEffect(() => {
    const fnTrim = urlSearch.fn?.trim()
    const hasAir = !!(urlSearch.from ?? urlSearch.to)
    if (!fnTrim && !hasAir) return
    const key = `${urlSearch.df ?? ''}|${urlSearch.dt ?? ''}|${fnTrim ?? ''}|${urlSearch.from ?? ''}|${urlSearch.to ?? ''}`
    if (lastBootstrapKey.current === key) return
    lastBootstrapKey.current = key
    setDateFrom(urlSearch.df ?? '')
    setDateTo(urlSearch.dt ?? '')
    setFlightNumber(fnTrim ?? '')
    setOriginIata(urlSearch.from ?? '')
    setDestIata(urlSearch.to ?? '')
    void executeSearch({
      dateFrom: urlSearch.df ?? '',
      dateTo: urlSearch.dt ?? '',
      flightNumber: fnTrim ?? '',
      originIata: urlSearch.from ?? '',
      destIata: urlSearch.to ?? '',
    })
  }, [urlSearch.df, urlSearch.dt, urlSearch.fn, urlSearch.from, urlSearch.to, executeSearch])

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
            fr24FlightId: hit.fr24FlightId.startsWith('al:')
              ? null
              : hit.fr24FlightId,
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

  const totalPages =
    results && results.length > 0
      ? Math.max(1, Math.ceil(results.length / RESULTS_PAGE_SIZE))
      : 1
  const effectivePage = Math.min(
    Math.max(1, urlSearch.page ?? 1),
    totalPages,
  )
  const pageHits =
    results?.slice(
      (effectivePage - 1) * RESULTS_PAGE_SIZE,
      effectivePage * RESULTS_PAGE_SIZE,
    ) ?? []

  const setResultsPage = useCallback(
    (next: number) => {
      const p = Math.min(Math.max(1, next), totalPages)
      void navigate({
        to: '/my-flights/search',
        replace: true,
        search: (prev) => ({ ...prev, page: p }),
      })
    },
    [navigate, totalPages],
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
        Search flights
      </h1>
      <p className="text-(--muted) mb-6 text-sm">
        Look up timetable legs (AirLabs). Dates are UTC. With no dates, search
        runs from one week before today through one week after. Only a start
        date searches forward; only an end date searches backward (each open end
        uses a 45-day window). Optional IATA origin and destination narrow to
        one route.
      </p>

      <div className="mb-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-(--sea-ink)">
          Flight number (optional if you pick airports)
          <input
            value={flightNumber}
            onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
            placeholder="D84322 / NSZ4322"
            className="rounded-lg border border-(--line) bg-(--chip-bg) px-3 py-2 font-mono font-normal tracking-wide"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-(--sea-ink)">
          <span>
            Departure and arrival airport (optional) — search by city, airport name, or IATA code
          </span>
          <div className="flex flex-wrap items-start gap-2 sm:max-w-md">
            <AirportAutocompleteInput
              valueIata={originIata}
              onChangeIata={setOriginIata}
              docs={airportDocs}
              placeholder={"Nice, NCE, Côte d'Azur…"}
              ariaLabel="Origin airport"
            />
            <span className="text-(--muted) shrink-0 pt-2">→</span>
            <AirportAutocompleteInput
              valueIata={destIata}
              onChangeIata={setDestIata}
              docs={airportDocs}
              placeholder="Stockholm, ARN, Arlanda…"
              ariaLabel="Destination airport"
            />
          </div>
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-(--sea-ink)">
            Start date (optional, UTC)
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-(--line) bg-(--chip-bg) px-3 py-2 font-normal"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-(--sea-ink)">
            End date (optional, UTC)
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-(--line) bg-(--chip-bg) px-3 py-2 font-normal"
            />
          </label>
        </div>
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
        <div className="text-(--muted) space-y-2 text-sm">
          <p className="m-0">
            No schedule rows for that search. Try widening the date range,
            clearing the route filter, or check the flight number.
          </p>
        </div>
      )}

      {results && results.length > 0 && (
        <>
          <p className="text-(--muted) mb-3 text-sm tabular-nums">
            {results.length} result{results.length === 1 ? '' : 's'}
            {totalPages > 1
              ? ` · Page ${effectivePage} of ${totalPages}`
              : ''}
          </p>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {pageHits.map((hit) => {
            const canOpen = hasFlightInfo(hit)
            const isAdded = addedFr24Ids.has(hit.fr24FlightId)
            const rowMain = (
              <>
                <p className="flex items-center gap-2 font-mono text-base font-bold tracking-wider text-(--sea-ink)">
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
                <p className="text-(--sea-ink) m-0 mt-0.5 font-mono text-sm tracking-wide">
                  {hit.originIata && hit.destIata
                    ? `${hit.originIata} → ${hit.destIata}`
                    : '—'}
                </p>
                {(hit.scheduledDeparture ||
                  hit.takeoffAt ||
                  hit.scheduledArrival) && (
                  <p className="text-(--muted) m-0 mt-1 font-mono text-xs tabular-nums">
                    {(() => {
                      const dep = hit.scheduledDeparture ?? hit.takeoffAt
                      const arr = hit.scheduledArrival
                      const depL = dep
                        ? new Date(dep).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : ''
                      const arrL = arr
                        ? new Date(arr).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : ''
                      if (depL && arrL) return `${depL} – ${arrL}`
                      return depL || arrL
                    })()}
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
                    className={cn(rowMainClass, 'text-inherit no-underline')}
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
          {totalPages > 1 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                disabled={effectivePage <= 1}
                onClick={() => setResultsPage(effectivePage - 1)}
                className={cn(
                  'rounded-lg border border-(--line) px-3 py-2 text-sm font-semibold',
                  'bg-(--chip-bg) hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40',
                )}
              >
                Previous
              </button>
              <span className="text-(--muted) text-sm tabular-nums">
                {effectivePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={effectivePage >= totalPages}
                onClick={() => setResultsPage(effectivePage + 1)}
                className={cn(
                  'rounded-lg border border-(--line) px-3 py-2 text-sm font-semibold',
                  'bg-(--chip-bg) hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40',
                )}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </main>
  )
}
