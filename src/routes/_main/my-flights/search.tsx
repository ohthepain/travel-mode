import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, Check, Loader2, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { authClient } from '../../../lib/auth-client'
import { ensureAirlinesLoaded } from '#/lib/airlines-client'
import { airportsList, ensureAirportsLoaded } from '#/lib/airports-client'
import { citiesList, ensureCitiesLoaded } from '#/lib/cities-client'
import { countriesByCode, ensureCountriesLoaded } from '#/lib/countries-client'
import { buildLocationSearchDocs } from '#/lib/location-autocomplete'
import type { LocationSearchDoc } from '#/lib/location-autocomplete'
import { AirportAutocompleteInput } from '../../../components/AirportAutocompleteInput'
import type { LocationSelection } from '../../../components/AirportAutocompleteInput'
import { MapPackStatusIndicator } from '../../../components/MapPackStatusIndicator'
import { cn } from '../../../lib/cn'
import type { FlightSchedule } from '../../../lib/flight-data'

type MyFlightsSearchParams = {
  /** @deprecated use df/dt */
  date?: string
  df?: string
  dt?: string
  fn?: string
  /** IATA airport code or travel city code */
  from?: string
  to?: string
  /** Present when {@link MyFlightsSearchParams.from} is a metropolitan / city code */
  fromKind?: 'city' | 'airport'
  /** Present when {@link MyFlightsSearchParams.to} is a metropolitan / city code */
  toKind?: 'city' | 'airport'
}

function parseLocationCode(v: unknown): string | undefined {
  return typeof v === 'string' && /^[A-Za-z0-9]{3}$/.test(v)
    ? v.toUpperCase()
    : undefined
}

function parseLocationKind(v: unknown): 'airport' | 'city' | undefined {
  if (v === 'city') return 'city'
  if (v === 'airport') return 'airport'
  return undefined
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

function defaultSearchDateFrom(): string {
  return utcTodayYmd()
}

function defaultSearchDateTo(): string {
  return addUtcDays(utcTodayYmd(), 7)
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
    return { start: today, end: addUtcDays(today, 7) }
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

function* eachUtcDayInclusive(
  startYmd: string,
  endYmd: string,
): Generator<string> {
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
    const from = parseLocationCode(search.from)
    const to = parseLocationCode(search.to)
    const fromKind = parseLocationKind(search.fromKind)
    const toKind = parseLocationKind(search.toKind)
    return {
      df,
      dt,
      fn,
      from,
      to,
      fromKind,
      toKind,
    }
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

function selectionFromUrl(
  code: string | undefined,
  kind: 'airport' | 'city' | undefined,
): LocationSelection | null {
  if (!code?.trim()) return null
  return { kind: kind === 'city' ? 'city' : 'airport', code: code.trim().toUpperCase() }
}

async function fetchFlightScheduleApi(params: {
  flightNumber?: string
  /** YYYY-MM-DD when using per-day lookups (no airport filter). */
  date?: string
  dep_iata?: string
  arr_iata?: string
  dep_city?: string
  arr_city?: string
}): Promise<ScheduleApiItem[]> {
  const u = new URL('/api/flight-schedule', window.location.origin)
  const fn = params.flightNumber?.trim()
  if (fn) u.searchParams.set('flightNumber', fn)
  if (params.date) u.searchParams.set('date', params.date)
  if (params.dep_city) u.searchParams.set('dep_city', params.dep_city)
  else if (params.dep_iata) u.searchParams.set('dep_iata', params.dep_iata)
  if (params.arr_city) u.searchParams.set('arr_city', params.arr_city)
  else if (params.arr_iata) u.searchParams.set('arr_iata', params.arr_iata)
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
  const [dateFrom, setDateFrom] = useState(
    () => urlSearch.df ?? defaultSearchDateFrom(),
  )
  const [dateTo, setDateTo] = useState(
    () => urlSearch.dt ?? defaultSearchDateTo(),
  )
  const [flightNumber, setFlightNumber] = useState(() => urlSearch.fn ?? '')
  const [originSel, setOriginSel] = useState<LocationSelection | null>(() =>
    selectionFromUrl(urlSearch.from, urlSearch.fromKind),
  )
  const [destSel, setDestSel] = useState<LocationSelection | null>(() =>
    selectionFromUrl(urlSearch.to, urlSearch.toKind),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<SearchHit[] | null>(null)
  /** How many hits to render; grows as the user scrolls (all data already fetched). */
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE)
  const resultsRef = useRef<SearchHit[] | null>(null)
  resultsRef.current = results
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addedFr24Ids, setAddedFr24Ids] = useState(() => new Set<string>())
  const [locationDocs, setLocationDocs] = useState<LocationSearchDoc[]>([])
  const lastBootstrapKey = useRef<string | null>(null)

  useEffect(() => {
    void Promise.all([
      ensureAirlinesLoaded(),
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

  const executeSearch = useCallback(
    async (overrides?: {
      dateFrom?: string
      dateTo?: string
      flightNumber?: string
      originSel?: LocationSelection | null
      destSel?: LocationSelection | null
    }) => {
      const dfVal = (overrides?.dateFrom ?? dateFrom).trim()
      const dtVal = (overrides?.dateTo ?? dateTo).trim()
      const fn = (overrides?.flightNumber ?? flightNumber).trim().toUpperCase()
      const o = overrides?.originSel ?? originSel
      const d = overrides?.destSel ?? destSel

      const oCode = o?.code.trim().toUpperCase() ?? ''
      const dCode = d?.code.trim().toUpperCase() ?? ''
      const oIsCity = o?.kind === 'city'
      const dIsCity = d?.kind === 'city'

      if (!fn && !oCode && !dCode) {
        setError(
          'Enter a flight number, or pick at least one departure or arrival (airport or city).',
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
            df: dfVal || undefined,
            dt: dtVal || undefined,
            from: oCode || undefined,
            to: dCode || undefined,
            fromKind: oIsCity ? ('city' as const) : undefined,
            toKind: dIsCity ? ('city' as const) : undefined,
          }),
        })
      } catch {
        /* noop */
      }
      try {
        const { start, end } = resolveSearchRange(dfVal, dtVal)

        if (oCode || dCode) {
          const req: Parameters<typeof fetchFlightScheduleApi>[0] =
            fn ? { flightNumber: fn } : {}
          if (oCode) {
            if (oIsCity) req.dep_city = oCode
            else req.dep_iata = oCode
          }
          if (dCode) {
            if (dIsCity) req.arr_city = dCode
            else req.arr_iata = dCode
          }
          const raw = await fetchFlightScheduleApi(req)
          const inRange = filterSchedulesByUtcYmdRange(raw, start, end)
          inRange.sort((a, b) =>
            a.departure.time.localeCompare(b.departure.time),
          )
          const airportHits = inRange.map((s) =>
            scheduleRowToSearchHit(s, s.departure.time.slice(0, 10)),
          )
          setResults(airportHits)
          setVisibleCount(Math.min(RESULTS_PAGE_SIZE, airportHits.length))
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
        merged.sort((a, b) => a.departure.time.localeCompare(b.departure.time))
        const fnHits = merged.map((s) =>
          scheduleRowToSearchHit(s, s.departure.time.slice(0, 10)),
        )
        setResults(fnHits)
        setVisibleCount(Math.min(RESULTS_PAGE_SIZE, fnHits.length))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed')
      } finally {
        setLoading(false)
      }
    },
    [dateFrom, dateTo, flightNumber, destSel, originSel, navigate],
  )

  const signInReturnPath = useCallback(() => {
    const sp = new URLSearchParams()
    const dfs = dateFrom.trim()
    const dts = dateTo.trim()
    if (dfs) sp.set('df', dfs)
    if (dts) sp.set('dt', dts)
    const fn = flightNumber.trim().toUpperCase().replace(/\s+/g, '')
    if (fn) sp.set('fn', fn)
    const o = originSel?.code.trim().toUpperCase() ?? ''
    if (o) {
      sp.set('from', o)
      if (originSel?.kind === 'city') sp.set('fromKind', 'city')
    }
    const dest = destSel?.code.trim().toUpperCase() ?? ''
    if (dest) {
      sp.set('to', dest)
      if (destSel?.kind === 'city') sp.set('toKind', 'city')
    }
    return `/my-flights/search?${sp.toString()}`
  }, [dateFrom, dateTo, flightNumber, originSel, destSel])

  const swapOriginDest = useCallback(() => {
    const o = originSel
    setOriginSel(destSel)
    setDestSel(o)
  }, [originSel, destSel])

  useEffect(() => {
    const fnTrim = urlSearch.fn?.trim()
    const hasAir = !!(urlSearch.from ?? urlSearch.to)
    if (!fnTrim && !hasAir) return
    const resolvedDf = urlSearch.df ?? defaultSearchDateFrom()
    const resolvedDt = urlSearch.dt ?? defaultSearchDateTo()
    const key = `${resolvedDf}|${resolvedDt}|${fnTrim ?? ''}|${urlSearch.from ?? ''}|${urlSearch.fromKind ?? ''}|${urlSearch.to ?? ''}|${urlSearch.toKind ?? ''}`
    if (lastBootstrapKey.current === key) return
    lastBootstrapKey.current = key
    setDateFrom(resolvedDf)
    setDateTo(resolvedDt)
    setFlightNumber(fnTrim ?? '')
    setOriginSel(selectionFromUrl(urlSearch.from, urlSearch.fromKind))
    setDestSel(selectionFromUrl(urlSearch.to, urlSearch.toKind))
    void executeSearch({
      dateFrom: resolvedDf,
      dateTo: resolvedDt,
      flightNumber: fnTrim ?? '',
      originSel: selectionFromUrl(urlSearch.from, urlSearch.fromKind),
      destSel: selectionFromUrl(urlSearch.to, urlSearch.toKind),
    })
  }, [
    urlSearch.df,
    urlSearch.dt,
    urlSearch.fn,
    urlSearch.from,
    urlSearch.fromKind,
    urlSearch.to,
    urlSearch.toKind,
    executeSearch,
  ])

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

  useEffect(() => {
    const el = loadMoreSentinelRef.current
    if (!el) return

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry.isIntersecting || loading) return
        const r = resultsRef.current
        if (!r?.length) return
        setVisibleCount((v) => {
          if (v >= r.length) return v
          return Math.min(v + RESULTS_PAGE_SIZE, r.length)
        })
      },
      { root: null, rootMargin: '180px', threshold: 0 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [results, loading])

  const displayedHits = results?.slice(0, visibleCount) ?? []
  const hasMore =
    !!results?.length &&
    visibleCount < results.length &&
    !loading

  const searchFieldClass =
    'rounded-lg border border-(--line) bg-(--chip-bg) px-3 py-2 font-normal outline-none ring-cyan-500/35 focus-visible:ring-2'

  return (
    <main className="mx-auto w-full max-w-5xl px-3 pb-10 pt-6 sm:px-4">
      <p className="mb-1">
        <Link
          to="/my-flights"
          className="text-sm font-medium text-cyan-600 no-underline hover:underline dark:text-cyan-400"
        >
          ← My flights
        </Link>
      </p>
      <h1 className="mt-0 mb-3 text-2xl font-semibold text-(--sea-ink)">
        Search flights
      </h1>
      <p className="text-(--muted) mb-6 max-w-3xl text-sm">
        Timetable search (AirLabs). Dates use the UTC calendar. Optional origin
        and destination narrow routes; optionally add a flight number. Clearing
        both dates defaults the range to today through one week ahead; a single
        date keeps a 45-day open end.
      </p>

      <div className="mb-8 overflow-hidden rounded-2xl border border-(--line) bg-(--surface-strong) shadow-sm [&_label]:cursor-pointer">
        <div className="flex flex-col divide-y divide-(--line) md:flex-row md:flex-nowrap md:divide-x md:divide-y-0 md:items-stretch">
          {/* Origin */}
          <div className="group/field relative flex min-h-13 min-w-0 flex-1 flex-col justify-center px-3 py-2.5">
            <span className="text-(--muted) mb-0.5 text-[11px] font-semibold uppercase tracking-wide">
              From
            </span>
            <AirportAutocompleteInput
              valueSelection={originSel}
              onChangeSelection={setOriginSel}
              docs={locationDocs}
              placeholder={"City, airport, code…"}
              ariaLabel="Origin airport or city"
              className="min-w-0"
              inputClassName="border-0 bg-transparent px-0 py-1 text-sm font-medium text-(--sea-ink) shadow-none focus-visible:ring-2 focus-visible:ring-cyan-500/35"
            />
          </div>

          {/* Swap — desktop: between columns; mobile: centered row */}
          <div className="flex items-center justify-center py-1 md:w-12 md:shrink-0 md:py-0">
            <button
              type="button"
              onClick={swapOriginDest}
              title="Swap origin and destination"
              aria-label="Swap origin and destination"
              className={cn(
                'flex size-10 items-center justify-center rounded-full',
                'border border-(--line) bg-(--chip-bg) text-(--sea-ink)',
                'hover:bg-black/4 dark:hover:bg-white/6',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500',
              )}
            >
              <ArrowLeftRight className="size-4" aria-hidden />
            </button>
          </div>

          {/* Destination */}
          <div className="group/field relative flex min-h-13 min-w-0 flex-1 flex-col justify-center px-3 py-2.5">
            <span className="text-(--muted) mb-0.5 text-[11px] font-semibold uppercase tracking-wide">
              To
            </span>
            <AirportAutocompleteInput
              valueSelection={destSel}
              onChangeSelection={setDestSel}
              docs={locationDocs}
              placeholder="City, airport, code…"
              ariaLabel="Destination airport or city"
              className="min-w-0"
              inputClassName="border-0 bg-transparent px-0 py-1 text-sm font-medium text-(--sea-ink) shadow-none focus-visible:ring-2 focus-visible:ring-cyan-500/35"
            />
          </div>

          {/* Date range */}
          <div className="flex min-w-0 flex-[1.15] flex-col justify-center gap-2 px-3 py-3 md:min-w-64 md:max-w-xl">
            <span className="text-(--muted) text-[11px] font-semibold uppercase tracking-wide">
              Dates (UTC)
            </span>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-(--sea-ink)">
                <span className="text-(--muted) font-normal">Start</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className={cn(searchFieldClass, 'w-full min-w-0 tabular-nums')}
                />
              </label>
              <span className="text-(--muted) hidden shrink-0 sm:mt-5 sm:inline">
                –
              </span>
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-(--sea-ink)">
                <span className="text-(--muted) font-normal">End</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className={cn(searchFieldClass, 'w-full min-w-0 tabular-nums')}
                />
              </label>
            </div>
          </div>

          {/* Search */}
          <div className="flex shrink-0 items-stretch p-3 md:flex-col md:justify-stretch">
            <button
              type="button"
              disabled={loading}
              onClick={() => void executeSearch()}
              className={cn(
                'w-full min-h-12 rounded-xl px-5 text-sm font-semibold whitespace-nowrap',
                'md:w-auto md:self-stretch md:px-6',
                'bg-cyan-600 text-slate-950 hover:bg-cyan-500',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </div>

        {/* Optional flight number — second band in the same card */}
        <div className="border-t border-(--line) px-3 py-3 sm:px-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-(--muted) text-[11px] font-semibold uppercase tracking-wide">
              Flight number{' '}
              <span className="font-normal normal-case opacity-90">(optional)</span>
            </span>
            <input
              value={flightNumber}
              onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
              placeholder="D84322 · NSZ4322"
              className={cn(
                searchFieldClass,
                'w-full max-w-xl font-mono font-normal tracking-wide',
              )}
            />
          </label>
        </div>
      </div>

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
            {hasMore
              ? ` · Showing ${visibleCount} of ${results.length}`
              : ''}
          </p>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {displayedHits.map((hit) => {
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
          {/* Sentinel for infinite scroll; extra rows reveal when scrolled into view. */}
          <div ref={loadMoreSentinelRef} className="h-1 w-full shrink-0" />
        </>
      )}
    </main>
  )
}
