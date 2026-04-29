import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '#/lib/cn'
import type { LocationKind, LocationSearchDoc } from '#/lib/location-autocomplete'
import { filterLocationDocs } from '#/lib/location-autocomplete'

export type LocationSelection = { kind: LocationKind; code: string }

type AirportAutocompleteInputProps = {
  valueSelection: LocationSelection | null
  onChangeSelection: (next: LocationSelection | null) => void
  docs: LocationSearchDoc[]
  placeholder?: string
  ariaLabel: string
  className?: string
  /** Extra classes for the text input (merged with defaults). */
  inputClassName?: string
}

function docKey(d: LocationSearchDoc): string {
  return `${d.kind}:${d.code}`
}

export function AirportAutocompleteInput({
  valueSelection,
  onChangeSelection,
  docs,
  placeholder,
  ariaLabel,
  className,
  inputClassName,
}: AirportAutocompleteInputProps) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const blurCloseTimer = useRef<number | null>(null)

  const docByKey = useMemo(() => {
    const m = new Map<string, LocationSearchDoc>()
    for (const d of docs) m.set(docKey(d), d)
    return m
  }, [docs])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), 100)
    return () => window.clearTimeout(t)
  }, [query])

  const suggestions = useMemo(
    () => filterLocationDocs(docs, debouncedQuery, 16),
    [docs, debouncedQuery],
  )

  useEffect(() => {
    if (focused) return
    if (!valueSelection) {
      setQuery('')
      return
    }
    const k = docKey({
      kind: valueSelection.kind,
      code: valueSelection.code,
      search: '',
      display: '',
    })
    const doc = docByKey.get(k)
    setQuery(doc?.display ?? valueSelection.code)
  }, [
    valueSelection,
    docByKey,
    focused,
    docs.length,
  ])

  const open =
    focused &&
    suggestions.length > 0 &&
    debouncedQuery.trim().length > 0

  useEffect(() => {
    setHighlight(0)
  }, [debouncedQuery, suggestions.length])

  const pick = useCallback(
    (doc: LocationSearchDoc) => {
      onChangeSelection({ kind: doc.kind, code: doc.code })
      setQuery(doc.display)
      setFocused(false)
    },
    [onChangeSelection],
  )

  const flushBlurClose = useCallback(() => {
    if (blurCloseTimer.current !== null) {
      clearTimeout(blurCloseTimer.current)
      blurCloseTimer.current = null
    }
  }, [])

  const normalizeOnBlur = useCallback(() => {
    const q = query.trim().toUpperCase()
    if (/^[A-Z0-9]{3}$/.test(q)) {
      const airportHit = docByKey.get(`airport:${q}`)
      if (airportHit) {
        onChangeSelection({ kind: 'airport', code: q })
        setQuery(airportHit.display)
        return
      }
      const cityHit = docByKey.get(`city:${q}`)
      if (cityHit) {
        onChangeSelection({ kind: 'city', code: q })
        setQuery(cityHit.display)
        return
      }
    }
    if (valueSelection) {
      const k = docKey({
        kind: valueSelection.kind,
        code: valueSelection.code,
        search: '',
        display: '',
      })
      const doc = docByKey.get(k)
      if (doc) setQuery(doc.display)
    } else {
      setQuery('')
    }
  }, [query, docByKey, onChangeSelection, valueSelection])

  return (
    <div className={cn('relative min-w-0 flex-1', className)}>
      <input
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={query}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        role="combobox"
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value
          setQuery(v)
          if (!v.trim()) onChangeSelection(null)
        }}
        onFocus={() => {
          flushBlurClose()
          setFocused(true)
        }}
        onBlur={() => {
          blurCloseTimer.current = window.setTimeout(() => {
            blurCloseTimer.current = null
            setFocused(false)
            normalizeOnBlur()
          }, 120)
        }}
        onKeyDown={(e) => {
          if (!open) return
          if (e.key === 'Escape') {
            e.preventDefault()
            setFocused(false)
            normalizeOnBlur()
            return
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((h) => Math.min(h + 1, suggestions.length - 1))
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
            return
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            pick(suggestions[highlight])
            return
          }
        }}
        className={cn(
          'w-full rounded-lg border border-(--line) bg-(--chip-bg) px-3 py-2 font-normal',
          inputClassName,
        )}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="border-(--line) absolute left-0 right-0 z-30 mt-1 max-h-60 list-none overflow-auto rounded-lg border bg-(--header-bg) p-0 shadow-lg"
        >
          {suggestions.map((doc, i) => (
            <li key={docKey(doc)} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={cn(
                  'hover:bg-black/4 dark:hover:bg-white/6 w-full cursor-pointer border-0 px-3 py-2 text-left text-sm text-(--sea-ink)',
                  i === highlight && 'bg-black/6 dark:bg-white/9',
                )}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => pick(doc)}
              >
                <span className="text-(--muted) mr-2 text-xs uppercase">
                  {doc.kind === 'city' ? 'City' : 'Airport'}
                </span>
                {doc.display}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
