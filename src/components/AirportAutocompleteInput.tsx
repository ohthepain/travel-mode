import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '#/lib/cn'
import type { AirportSearchDoc } from '#/lib/airport-autocomplete'
import { filterAirportDocs } from '#/lib/airport-autocomplete'

type AirportAutocompleteInputProps = {
  valueIata: string
  onChangeIata: (iata: string) => void
  docs: AirportSearchDoc[]
  placeholder?: string
  ariaLabel: string
  className?: string
}

export function AirportAutocompleteInput({
  valueIata,
  onChangeIata,
  docs,
  placeholder,
  ariaLabel,
  className,
}: AirportAutocompleteInputProps) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const blurCloseTimer = useRef<number | null>(null)

  const docByIata = useMemo(() => {
    const m = new Map<string, AirportSearchDoc>()
    for (const d of docs) m.set(d.id, d)
    return m
  }, [docs])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), 100)
    return () => window.clearTimeout(t)
  }, [query])

  const suggestions = useMemo(
    () => filterAirportDocs(docs, debouncedQuery, 12),
    [docs, debouncedQuery],
  )

  useEffect(() => {
    if (focused) return
    const code = valueIata.trim().toUpperCase()
    if (!code) {
      setQuery('')
      return
    }
    const doc = docByIata.get(code)
    setQuery(doc?.display ?? code)
  }, [valueIata, docByIata, focused, docs.length])

  const open = focused && suggestions.length > 0 && debouncedQuery.trim().length > 0

  useEffect(() => {
    setHighlight(0)
  }, [debouncedQuery, suggestions.length])

  const pick = useCallback(
    (doc: AirportSearchDoc) => {
      onChangeIata(doc.id)
      setQuery(doc.display)
      setFocused(false)
    },
    [onChangeIata],
  )

  const flushBlurClose = useCallback(() => {
    if (blurCloseTimer.current !== null) {
      clearTimeout(blurCloseTimer.current)
      blurCloseTimer.current = null
    }
  }, [])

  const normalizeOnBlur = useCallback(() => {
    const q = query.trim().toUpperCase()
    if (/^[A-Z]{3}$/.test(q) && docByIata.has(q)) {
      const doc = docByIata.get(q)!
      onChangeIata(doc.id)
      setQuery(doc.display)
      return
    }
    const code = valueIata.trim().toUpperCase()
    if (code && docByIata.has(code)) {
      setQuery(docByIata.get(code)!.display)
    } else if (!code) {
      setQuery('')
    }
  }, [query, docByIata, onChangeIata, valueIata])

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
          if (!v.trim()) onChangeIata('')
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
        className="w-full rounded-lg border border-(--line) bg-(--chip-bg) px-3 py-2 font-normal"
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="border-(--line) absolute left-0 right-0 z-30 mt-1 max-h-60 list-none overflow-auto rounded-lg border bg-(--header-bg) p-0 shadow-lg"
        >
          {suggestions.map((doc, i) => (
            <li key={doc.id} role="presentation">
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
                {doc.display}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
