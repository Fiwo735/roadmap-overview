import { useRef, useState } from 'react'
import { useTripStore } from '../../store/tripStore'

/**
 * Inline-editable trip title. Typing only changes local state; the store (and so the undo history)
 * sees one change when the edit is committed with Enter or blur. Escape discards it.
 */
export function TripTitle() {
  const title = useTripStore((s) => s.trip.title)
  const setTitle = useTripStore((s) => s.setTitle)
  const [draft, setDraft] = useState<string | null>(null)
  // Escape blurs the input, and blur commits: this flag makes that blur discard instead.
  const cancelled = useRef(false)

  const commit = () => {
    if (draft !== null && !cancelled.current) setTitle(draft.trim())
    cancelled.current = false
    setDraft(null)
  }

  return (
    <input
      className="trip-title"
      data-testid="trip-title"
      aria-label="Trip title"
      placeholder="Untitled trip"
      value={draft ?? title}
      maxLength={120}
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
    />
  )
}
