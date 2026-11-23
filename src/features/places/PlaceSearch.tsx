import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { Spinner } from '../../components/Spinner'
import { regionLine } from '../../lib/geoResult'
import { isAbortError } from '../../lib/requestQueue'
import { searchPlaces, type GeoResult } from '../../services/nominatim'
import { getMap } from '../map/mapInstance'

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'results'; query: string; results: GeoResult[] }
  | { status: 'error' }

interface PlaceSearchProps {
  /** Accessible name of the input. */
  label: string
  initialQuery?: string
  placeholder?: string
  /** Focus the input (selecting its text) when it appears. */
  autoFocus?: boolean
  onPick: (result: GeoResult) => void
  /** Escape was pressed in the input. Results are closed first either way. */
  onEscape?: () => void
  /** Empty the field and results after a pick (for the "add a place" box). */
  resetOnPick?: boolean
  testId?: string
}

/**
 * The classic map search: type, press Enter (or the button) to search, pick a hit with the mouse or
 * ↑/↓ + Enter. It never searches while typing (Nominatim's usage policy), only on submit.
 */
export function PlaceSearch({
  label,
  initialQuery = '',
  placeholder,
  autoFocus = false,
  onPick,
  onEscape,
  resetOnPick = false,
  testId = 'place-search',
}: PlaceSearchProps) {
  const [query, setQuery] = useState(initialQuery)
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const viaKeyboard = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const listId = useId()

  useEffect(() => {
    if (!autoFocus) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [autoFocus])

  useEffect(() => () => controller.current?.abort(), [])

  // The results sit below the input, possibly below the fold of the scrolling sidebar.
  useEffect(() => {
    if (state.status !== 'idle') rootRef.current?.scrollIntoView({ block: 'nearest' })
  }, [state])

  // Arrow-key navigation keeps the highlighted result in view (hovering must not scroll the list).
  useEffect(() => {
    if (active >= 0 && viaKeyboard.current) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, listId])

  const results = state.status === 'results' ? state.results : []

  async function search() {
    const q = query.trim()
    if (!q) return
    controller.current?.abort()
    const mine = new AbortController()
    controller.current = mine
    setState({ status: 'loading' })
    setActive(-1)
    try {
      // Rank what the user is looking at first (a bias only: other places are still found).
      const view = getMap()?.getBounds()
      const viewbox = view
        ? { west: view.getWest(), south: view.getSouth(), east: view.getEast(), north: view.getNorth() }
        : undefined
      const found = await searchPlaces(q, { signal: mine.signal, viewbox })
      setState({ status: 'results', query: q, results: found })
    } catch (error) {
      if (!isAbortError(error)) setState({ status: 'error' })
    }
  }

  function reset() {
    controller.current?.abort()
    setState({ status: 'idle' })
    setActive(-1)
  }

  function pick(result: GeoResult) {
    onPick(result)
    if (resetOnPick) {
      setQuery('')
      reset()
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (active >= 0 && results[active]) pick(results[active])
      else void search()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (results.length === 0) return
      e.preventDefault()
      viaKeyboard.current = true
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i < 0 && step < 0 ? results.length - 1 : (i + step + results.length) % results.length))
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      reset()
      onEscape?.()
    }
  }

  const loading = state.status === 'loading'
  const open = state.status === 'results' && results.length > 0

  return (
    <div ref={rootRef} className="place-search" data-testid={testId}>
      <div className="place-search__field">
        <input
          ref={inputRef}
          className="place-search__input"
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={200}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            // Results belong to the text that was searched: once it changes they are stale, and
            // Enter must search the new text rather than pick a result of the old one.
            if (state.status !== 'idle') reset()
          }}
          onKeyDown={onKeyDown}
        />
        {loading ? (
          <span className="place-search__spinner">
            <Spinner size={16} />
          </span>
        ) : (
          <IconButton
            size="sm"
            label="Search"
            tooltip="Search (Enter)"
            icon={<Search size={16} />}
            disabled={!query.trim()}
            onClick={() => void search()}
          />
        )}
      </div>

      <div className="place-search__status" role="status" aria-live="polite">
        {loading ? (
          <p className="place-search__note">
            <Spinner size={14} /> Searching…
          </p>
        ) : null}
        {state.status === 'results' && results.length === 0 ? (
          <p className="place-search__note">No places found for “{state.query}”. Try a different spelling or a larger nearby town.</p>
        ) : null}
        {state.status === 'error' ? (
          <p className="place-search__note place-search__note--error">
            Search failed. Check your connection and try again.{' '}
            <button type="button" className="place-search__retry" onClick={() => void search()}>
              Try again
            </button>
          </p>
        ) : null}
      </div>

      {open ? (
        <ul id={listId} role="listbox" aria-label="Search results" className="place-search__results" data-testid="search-results">
          {results.map((r, i) => (
            <li
              key={`${r.lat},${r.lng},${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="place-search__result"
              data-active={i === active || undefined}
              title={r.address}
              onMouseMove={() => {
                viaKeyboard.current = false
                if (active !== i) setActive(i)
              }}
              // Keep focus in the input so the keyboard keeps working after a click that does not pick.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
            >
              <span className="place-search__name">{r.name || regionLine(r).split(',')[0]}</span>
              <span className="place-search__region">{regionLine(r)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
