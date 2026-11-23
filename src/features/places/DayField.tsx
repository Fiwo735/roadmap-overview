import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useTooltip } from '../../components/Tooltip'
import { parseDay } from '../../lib/trip'
import { useTripStore } from '../../store/tripStore'

interface DayFieldProps {
  placeId: string
  /** The place's name, for the accessible label. */
  name: string
  day: number
  /** When set, the day is earlier than the stop before it, which counts as this (effective) day. */
  earlierThan?: number
}

/**
 * Day of travel for a place: a compact integer field (≥ 0, no upper bound). Typing is free; the
 * value is committed on Enter or blur as ONE undo step, ↑/↓ step the draft, Escape reverts, and
 * anything that is not a whole number reverts to the saved day. If the saved day changes under an
 * open draft (undo, another edit), the new value wins and the draft is dropped.
 */
export function DayField({ placeId, name, day, earlierThan }: DayFieldProps) {
  // The draft remembers the day it started from, which is how a change underneath it is noticed.
  const [draft, setDraftState] = useState<{ text: string; from: number } | null>(null)
  // Handlers that run in the same tick (Enter, then the blur it causes) must see the latest draft.
  const latest = useRef<{ text: string; from: number } | null>(null)
  const descId = useId()
  const setDraft = (text: string | null) => {
    const next = text === null ? null : { text, from: day }
    latest.current = next
    setDraftState(next)
  }
  const warning = earlierThan !== undefined
  const message = warning
    ? `Day ${day} is earlier than the previous stop (day ${earlierThan}), so it counts as day ${earlierThan}.`
    : undefined
  const tip = useTooltip<HTMLLabelElement>(message)
  const shown = draft && draft.from === day ? draft.text : String(day)

  function commit() {
    const current = latest.current
    setDraft(null)
    const parsed = current && current.from === day ? parseDay(current.text) : null
    if (parsed !== null && parsed !== day) useTripStore.getState().updatePlace(placeId, { day: parsed })
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      // Revert and leave the field. Stop here: Escape in a field must not also close the mobile
      // slide-over behind it.
      e.stopPropagation()
      setDraft(null)
      e.currentTarget.blur()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const base = parseDay(shown) ?? day
      setDraft(String(Math.max(0, base + (e.key === 'ArrowUp' ? 1 : -1))))
    }
  }

  return (
    <>
      <label
        className="day-field"
        data-warning={warning || undefined}
        data-testid="day-field"
        {...tip.props}
      >
        {warning ? <TriangleAlert size={12} aria-hidden="true" /> : null}
        <span className="day-field__caption" aria-hidden="true">
          Day
        </span>
        <input
          className="day-field__input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={15}
          aria-label={`Day of travel for ${name}`}
          aria-invalid={warning || undefined}
          aria-describedby={warning ? descId : undefined}
          value={shown}
          style={{ width: `${Math.max(2, shown.length) + 0.5}ch` }}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        {warning ? (
          <span id={descId} className="sr-only">
            {message}
          </span>
        ) : null}
      </label>
      {tip.tooltip}
    </>
  )
}
