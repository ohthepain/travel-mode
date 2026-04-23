import { createFileRoute, Link } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { authClient } from '../../../lib/auth-client'
import { cn } from '../../../lib/cn'
import { MapPackStatusIndicator } from '../../../components/MapPackStatusIndicator'

export const Route = createFileRoute('/_main/my-flights/')({
  component: MyFlightsPage,
})

type SavedFlight = {
  id: string
  flightNumber: string
  travelDate: string
  fr24FlightId: string | null
  originIata: string | null
  destIata: string | null
  scheduledDeparture: string | null
  scheduledArrival: string | null
  takeoffAt: string | null
}

function MyFlightsPage() {
  const session = authClient.useSession()
  const [flights, setFlights] = useState<SavedFlight[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session.data?.user) {
      setFlights([])
      return
    }
    setErr(null)
    const r = await fetch('/api/flights/saved', { credentials: 'include' })
    if (!r.ok) {
      setErr(await r.text())
      setFlights([])
      return
    }
    const j = (await r.json()) as { flights: SavedFlight[] }
    setFlights(j.flights)
  }, [session.data?.user])

  useEffect(() => {
    void load()
  }, [load])

  const removeFlight = useCallback(
    async (id: string, label: string) => {
      setDeletingId(id)
      try {
        const r = await fetch(`/api/flights/saved/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (!r.ok) {
          const t = await r.text()
          toast.error(t || 'Could not remove flight')
          return
        }
        toast.success(`Removed ${label}`)
        await load()
      } finally {
        setDeletingId(null)
      }
    },
    [load],
  )

  return (
    <main className="mx-auto w-full max-w-lg px-3 pb-10 pt-6 sm:max-w-xl sm:px-4">
      <div className="mb-6 flex flex-col gap-2">
        <p className="m-0 text-sm tracking-wide text-cyan-500/90 dark:text-cyan-400/90">
          travelmode.live
        </p>
        <h1 className="m-0 text-2xl font-semibold text-[var(--sea-ink)]">
          My flights
        </h1>
      </div>

      <Link
        to="/my-flights/search"
        className={cn(
          'mb-8 inline-flex items-center justify-center rounded-lg bg-cyan-600 px-4 py-2.5',
          'text-sm font-semibold text-white no-underline shadow-sm transition',
          'hover:bg-cyan-500 hover:text-white',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
          '[text-decoration:none]',
        )}
      >
        Add flight
      </Link>

      {!session.data?.user && (
        <p className="text-[var(--muted)] rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-3 text-sm">
          <Link
            to="/sign-in"
            className="font-semibold text-cyan-600 dark:text-cyan-400"
          >
            Sign in
          </Link>{' '}
          to save flights and see them here.
        </p>
      )}

      {err && (
        <p className="text-amber-700 dark:text-amber-200 mb-4 text-sm">{err}</p>
      )}

      {session.data?.user && flights && flights.length === 0 && !err && (
        <p className="text-[var(--muted)] text-sm">
          No flights yet. Use <strong>Add flight</strong> to search by date and
          flight number.
        </p>
      )}

      {flights && flights.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {flights.map((f) => (
            <li
              key={f.id}
              className={cn(
                'rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] p-4',
                'shadow-sm',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <MapPackStatusIndicator
                    flightNumber={f.flightNumber}
                    travelDate={f.travelDate}
                  />
                  <Link
                    to="/flight/$flightNumber"
                    params={{ flightNumber: f.flightNumber }}
                    search={{ date: f.travelDate }}
                    className={cn(
                      'font-mono text-lg font-bold tracking-wider text-[var(--sea-ink)] no-underline',
                      'rounded-md border border-cyan-500/35 bg-slate-900/80 px-3 py-1.5',
                      'dark:border-cyan-400/30 dark:bg-slate-950/80',
                      'hover:border-cyan-500/60 hover:bg-slate-900',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500',
                    )}
                  >
                    {f.flightNumber}
                  </Link>
                </div>
                <div className="flex shrink-0 items-start gap-1 sm:gap-2">
                  <TakeoffCountdown
                    targetIso={f.scheduledDeparture ?? f.takeoffAt}
                  />
                  <button
                    type="button"
                    disabled={deletingId === f.id}
                    onClick={() => void removeFlight(f.id, f.flightNumber)}
                    className={cn(
                      'rounded-lg border border-red-500/35 bg-red-500/10 p-2 text-red-700',
                      'transition hover:border-red-500/55 hover:bg-red-500/15',
                      'dark:text-red-300',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                    )}
                    aria-label={`Remove ${f.flightNumber} from list`}
                  >
                    <Trash2 className="size-4" strokeWidth={2} aria-hidden />
                  </button>
                </div>
              </div>
              <p className="text-[var(--muted)] mt-2 mb-0 text-xs">
                {f.travelDate}
                {f.originIata && f.destIata
                  ? ` · ${f.originIata} → ${f.destIata}`
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

function TakeoffCountdown({ targetIso }: { targetIso: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!targetIso) {
    return (
      <span className="text-[var(--muted)] font-mono text-sm tabular-nums">
        —:—:—
      </span>
    )
  }

  const t = new Date(targetIso).getTime()
  if (Number.isNaN(t)) {
    return <span className="text-[var(--muted)] text-sm">Schedule TBD</span>
  }

  const delta = t - now
  if (delta <= 0) {
    return (
      <span className="text-sm font-medium text-amber-600 dark:text-amber-300">
        Departed
      </span>
    )
  }

  const sec = Math.floor(delta / 1000)
  const d = Math.floor(sec / 86_400)
  const h = Math.floor((sec % 86_400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  const label =
    d > 0
      ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`
      : `${pad(h)}:${pad(m)}:${pad(s)}`

  return (
    <div className="text-right">
      <p className="text-[var(--muted)] m-0 text-[10px] font-medium uppercase tracking-wide">
        Take-off in
      </p>
      <p className="font-mono text-base font-semibold tabular-nums tracking-tight text-cyan-700 dark:text-cyan-300">
        {label}
      </p>
    </div>
  )
}
