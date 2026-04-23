import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '../lib/cn'

type ThemeMode = 'light' | 'dark' | 'auto'

const OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'auto', label: 'System (match device)', icon: Monitor },
]

function getInitialMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'auto'
  }
  const stored = window.localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    return stored
  }
  return 'auto'
}

function applyThemeMode(mode: ThemeMode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode

  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(resolved)

  if (mode === 'auto') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', mode)
  }

  document.documentElement.style.colorScheme = resolved
}

export default function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>('auto')

  useEffect(() => {
    const initial = getInitialMode()
    setMode(initial)
    applyThemeMode(initial)
  }, [])

  useEffect(() => {
    if (mode !== 'auto') {
      return
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyThemeMode('auto')
    media.addEventListener('change', onChange)
    return () => {
      media.removeEventListener('change', onChange)
    }
  }, [mode])

  function setColorScheme(next: ThemeMode) {
    setMode(next)
    applyThemeMode(next)
    window.localStorage.setItem('theme', next)
  }

  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border border-[var(--chip-line)]',
        'bg-[color-mix(in_oklab,var(--chip-bg)_75%,transparent)] p-0.5 shadow-sm',
        className,
      )}
      role="group"
      aria-label="Color scheme"
    >
      {OPTIONS.map(({ mode: optionMode, label, icon: Icon }) => {
        const selected = mode === optionMode
        return (
          <button
            key={optionMode}
            type="button"
            onClick={() => setColorScheme(optionMode)}
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-sm outline-none',
              'transition-[color,background-color,box-shadow] duration-150',
              'text-[var(--sea-ink-soft)]',
              'hover:bg-[var(--link-bg-hover)]/90 hover:text-[var(--sea-ink)]',
              'focus-visible:ring-2 focus-visible:ring-[var(--lagoon)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--header-bg)]',
              selected &&
                'bg-[var(--chip-bg)] text-[var(--sea-ink)] shadow-sm ring-1 ring-[var(--line)]/80',
            )}
            aria-pressed={selected}
            aria-label={label}
            title={label}
          >
            <Icon className="size-[1.125rem]" strokeWidth={2} aria-hidden />
          </button>
        )
      })}
    </div>
  )
}
