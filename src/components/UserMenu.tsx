import { Link } from '@tanstack/react-router'
import { User } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { signOut, useSession } from '../lib/auth-client'
import { cn } from '../lib/cn'
import { useAppOptionsStore } from '../stores/app-options'

export function UserMenu() {
  const session = useSession()
  const user = session.data?.user
  const devMode = useAppOptionsStore((s) => s.devMode)
  const setDevMode = useAppOptionsStore((s) => s.setDevMode)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const label = user
    ? `Account: ${user.name || user.email}`
    : 'Account menu — sign in'

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const hasName = Boolean(user?.name && user.name.trim() !== '')

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={cn(
          'flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)]',
          'text-[var(--sea-ink)] transition hover:bg-[var(--link-bg-hover)]',
          'focus-visible:ring-2 focus-visible:ring-[var(--lagoon)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--header-bg)]',
          'outline-none',
          open && 'ring-2 ring-[var(--lagoon)]/30',
        )}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        {user?.image ? (
          <img
            src={user.image}
            alt=""
            className="h-full w-full object-cover"
            width={36}
            height={36}
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : (
          <User className="h-5 w-5" strokeWidth={2} aria-hidden />
        )}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className={cn(
            'absolute right-0 top-full z-[100] mt-1.5 min-w-[14rem] rounded-lg border border-[var(--line)] bg-[var(--header-bg)]',
            'p-1 shadow-lg backdrop-blur-md',
            'ring-1 ring-[var(--line)]/60',
          )}
        >
          {user && (
            <div
              className="border-b border-[var(--line)] px-3 py-2.5"
              role="none"
            >
              {hasName ? (
                <>
                  <p className="m-0 max-w-[16rem] truncate text-sm font-semibold text-[var(--sea-ink)]">
                    {user.name}
                  </p>
                  {user.email && (
                    <p className="m-0 mt-0.5 max-w-[16rem] truncate text-xs text-[var(--sea-ink-soft)]">
                      {user.email}
                    </p>
                  )}
                </>
              ) : (
                <p className="m-0 max-w-[16rem] truncate text-sm font-semibold text-[var(--sea-ink)]">
                  {user.email}
                </p>
              )}
            </div>
          )}

          {user && devMode && (
            <div
              className="border-b border-[var(--line)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--sea-ink-soft)]"
              role="none"
            >
              <span className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--kicker)]">
                User id
              </span>
              <p className="m-0 mt-1 break-all text-[var(--sea-ink)]">{user.id}</p>
            </div>
          )}

          <Link
            to="/admin"
            role="menuitem"
            className="block rounded-md px-3 py-2 text-sm font-medium text-[var(--lagoon-deep)] no-underline outline-none hover:bg-[var(--link-bg-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--lagoon)]/40"
            onClick={() => setOpen(false)}
          >
            Admin
          </Link>

          <div className="my-0.5 h-px bg-[var(--line)]" role="none" />

          <button
            type="button"
            role="menuitem"
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-medium',
              'text-[var(--sea-ink)] outline-none hover:bg-[var(--link-bg-hover)]',
              'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--lagoon)]/40',
              devMode && 'text-orange-600 dark:text-orange-400',
            )}
            aria-pressed={devMode}
            onClick={() => setDevMode(!devMode)}
          >
            <span>Dev mode</span>
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide',
                devMode
                  ? 'bg-orange-500/20 text-orange-600 dark:text-orange-400'
                  : 'bg-[var(--line)]/50 text-[var(--sea-ink-soft)]',
              )}
            >
              {devMode ? 'ON' : 'OFF'}
            </span>
          </button>

          <div className="my-0.5 h-px bg-[var(--line)]" role="none" />

          {user ? (
            <button
              type="button"
              role="menuitem"
              className={cn(
                'w-full rounded-md px-3 py-2 text-left text-sm font-medium text-[var(--sea-ink)]',
                'outline-none hover:bg-[var(--link-bg-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--lagoon)]/40',
              )}
              onClick={() => {
                setOpen(false)
                void signOut()
              }}
            >
              Sign out
            </button>
          ) : (
            <Link
              to="/sign-in"
              role="menuitem"
              className="block rounded-md px-3 py-2 text-sm font-medium text-[var(--lagoon-deep)] no-underline outline-none hover:bg-[var(--link-bg-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--lagoon)]/40"
              onClick={() => setOpen(false)}
            >
              Sign in
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
