import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '../lib/cn'
import { useFlightStore } from '../stores/flight'
import ThemeToggle from './ThemeToggle'
import { UserMenu } from './UserMenu'

type AppHeaderBrandProps = {
  className?: string
  /** Narrower type scale for the `h-14` bar. */
  compact?: boolean
}

/** Top-left app mark; navigates to My flights. */
export function AppHeaderBrand({ className, compact }: AppHeaderBrandProps) {
  return (
    <Link
      to="/my-flights"
      className={cn(
        'group flex shrink-0 items-center gap-1.5 rounded-md text-[var(--sea-ink)] no-underline outline-none',
        'focus-visible:ring-2 focus-visible:ring-[var(--lagoon)]/40',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]',
        className,
      )}
      aria-label="travelmode.live — My flights"
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-[linear-gradient(90deg,#56c6be,#7ed3bf)]"
        aria-hidden
      />
      <span
        className={cn(
          'font-bold tracking-tight',
          compact ? 'text-base sm:text-lg' : 'text-xl',
        )}
      >
        travelmode
      </span>
    </Link>
  )
}

const FLIGHT_PAGE_RE = /^\/flight\/[^/]+$/

export default function Header() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isFlightPage = FLIGHT_PAGE_RE.test(pathname)
  const mapMode = useFlightStore((s) => s.mapMode)
  const setMapMode = useFlightStore((s) => s.setMapMode)

  const shell =
    isFlightPage && !mapMode
      ? 'max-w-md px-3 sm:max-w-lg sm:px-4'
      : 'page-wrap px-3 sm:px-4'

  return (
    <header className="sticky top-0 z-50 shrink-0 bg-[var(--bg-base)]">
      <div
        className={cn(
          'mx-auto flex min-h-14 w-full flex-wrap items-center gap-x-2 gap-y-2 py-2 sm:flex-nowrap sm:gap-3 sm:py-0',
          shell,
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:contents sm:gap-0">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-min sm:shrink-0 sm:gap-3">
            <AppHeaderBrand compact className="min-w-0" />
            {isFlightPage && (
              <button
                type="button"
                onClick={() => setMapMode(!mapMode)}
                className={cn(
                  'shrink-0 rounded-md border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2.5 py-1.5',
                  'text-xs font-semibold text-[var(--sea-ink)] sm:text-sm',
                )}
                aria-pressed={mapMode}
              >
                {mapMode ? 'Setup' : 'Map'}
              </button>
            )}
          </div>

          <div className="hidden min-w-0 flex-1 items-center justify-center gap-3 text-sm font-semibold sm:flex">
            <Link
              to="/my-flights"
              className="nav-link"
              activeProps={{ className: 'nav-link is-active' }}
            >
              My flights
            </Link>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center justify-end gap-1.5 sm:w-auto sm:shrink-0 sm:gap-2">
          <ThemeToggle />
          <UserMenu />
        </div>

        <div className="flex w-full items-center gap-3 overflow-x-auto py-2 [scrollbar-width:none] sm:hidden [&::-webkit-scrollbar]:hidden">
          <Link
            to="/my-flights"
            className="nav-link shrink-0"
            activeProps={{ className: 'nav-link is-active' }}
          >
            My flights
          </Link>
        </div>
      </div>
    </header>
  )
}
