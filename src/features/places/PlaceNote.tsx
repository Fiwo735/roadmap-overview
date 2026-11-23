import { useEffect, useRef, useState } from 'react'
import { useTripStore } from '../../store/tripStore'

/** Longest note the field accepts (it is shown whole in the hover label on the map). */
export const NOTE_MAX_LENGTH = 1000

interface PlaceNoteProps {
  placeId: string
  /** The saved note, if any. */
  note: string
  placeName: string
  /** Escape was pressed: the saved note stays, and the caller closes the row. */
  onEscape: () => void
}

/** What is being typed, and the saved note it started from. */
interface Draft {
  text: string
  base: string
}

/** Save `text` as the note (trimmed; empty removes it) when it differs from the `saved` one: one undo step. */
function saveNote(placeId: string, text: string | undefined, saved: string): void {
  if (text === undefined) return
  const next = text.trim()
  if (next !== saved) useTripStore.getState().updatePlace(placeId, { note: next || undefined })
}

/**
 * The note of a place, in its expanded row. Typing only changes local state; leaving the field commits
 * it as ONE undo step (an empty note removes it), Escape puts the saved text back. A draft whose saved
 * note changed underneath (undo, redo) is dropped in favour of the new note.
 */
export function PlaceNote({ placeId, note, placeName, onEscape }: PlaceNoteProps) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  // Escape blurs the field and blur commits: this flag makes that blur discard instead.
  const cancelled = useRef(false)

  const live = draft && draft.base === note ? draft : null
  const shown = live?.text ?? note

  // The row collapsing with a draft pending (a removed field does not reliably blur): keep what was typed.
  const latest = useRef({ text: live?.text, note })
  useEffect(() => {
    latest.current = { text: live?.text, note }
  })
  useEffect(
    () => () => {
      if (!cancelled.current) saveNote(placeId, latest.current.text, latest.current.note)
    },
    [placeId],
  )

  // Grow with the text (the stylesheet caps the height).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [shown])

  return (
    <label className="place-note">
      <span className="place-note__label">Note</span>
      <textarea
        ref={ref}
        className="place-note__input"
        data-testid="place-note"
        aria-label={`Note for ${placeName}`}
        placeholder="Add a note: opening hours, what to see, where to park…"
        rows={2}
        maxLength={NOTE_MAX_LENGTH}
        value={shown}
        onChange={(e) => {
          cancelled.current = false
          setDraft({ text: e.target.value, base: note })
        }}
        onFocus={() => {
          cancelled.current = false
        }}
        onBlur={() => {
          if (!cancelled.current) saveNote(placeId, live?.text, note)
          setDraft(null)
        }}
        onKeyDown={(e) => {
          // Escape discards what was typed and closes the row; Enter is a new line.
          if (e.key === 'Escape') {
            e.stopPropagation()
            cancelled.current = true
            setDraft(null)
            onEscape()
          }
        }}
      />
    </label>
  )
}
