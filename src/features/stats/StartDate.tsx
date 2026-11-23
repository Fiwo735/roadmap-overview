import { CalendarDays, Check, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '../../components/IconButton'
import { isCalendarDate } from '../../lib/trip'
import { useTripStore } from '../../store/tripStore'
import { formatDateRange } from './dateRange'
import { useEditingLocked } from '../ride/rideStore'

/** Dates typed digit by digit pass through years such as 0002 and 0202; those are not trips. */
const isPlausible = (date: string) => isCalendarDate(date) && Number(date.slice(0, 4)) >= 1900

/**
 * The optional start date of the trip. Unset it is a quiet "Add dates" button; set it shows the dates
 * the trip covers (from the number of days), and a click edits the first day in a date field. Typing
 * or picking only changes the field: Enter, the check button or leaving the field commits the date
 * (one undo step per edit, however many segments of the field were changed), Escape discards it.
 */
export function StartDate({ days }: { days: number }) {
  // A ride locks every editing surface (F6).
  const locked = useEditingLocked()
  const startDate = useTripStore((s) => s.trip.startDate)
  const setStartDate = useTripStore((s) => s.setStartDate)
  const [draft, setDraft] = useState<string | null>(null)
  const display = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  // The editor is closing: a blur caused by its own removal must not apply the draft a second time.
  const closing = useRef(false)
  const editing = draft !== null

  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false
      display.current?.focus()
    }
  }, [editing])

  /** Apply the field's date if it is a complete, plausible, new one; then leave the editor. */
  const finish = (apply: boolean, focusBack = false) => {
    if (closing.current) return
    closing.current = true
    if (apply && draft && isPlausible(draft) && draft !== startDate) setStartDate(draft)
    refocus.current = focusBack
    setDraft(null)
  }

  if (editing) {
    return (
      <div
        className="start-date start-date--editing"
        onBlur={(e) => {
          // Focus moving between the field and its buttons keeps the editor open; leaving it commits.
          if (!e.currentTarget.contains(e.relatedTarget)) finish(true)
        }}
      >
        <input
          type="date"
          className="start-date__input"
          data-testid="start-date-input"
          aria-label="Start date of the first day"
          value={draft}
          min="1900-01-01"
          max="9999-12-31"
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault()
              finish(e.key === 'Enter', true)
            }
          }}
        />
        <IconButton size="sm" label="Apply start date" icon={<Check size={16} />} data-testid="start-date-apply" onClick={() => finish(true, true)} />
        {startDate ? (
          <IconButton
            size="sm"
            label="Remove start date"
            icon={<X size={16} />}
            data-testid="start-date-clear"
            onClick={() => {
              setStartDate(undefined)
              finish(false, true)
            }}
          />
        ) : null}
      </div>
    )
  }

  // Nothing to show and nothing to add: no "Add dates" prompt while editing is locked.
  if (locked && !startDate) return null
  const range = startDate ? formatDateRange(startDate, days) : ''
  return (
    <button
      ref={display}
      type="button"
      className={['start-date', range ? '' : 'is-empty'].filter(Boolean).join(' ')}
      data-testid="start-date"
      aria-label={range ? `Trip dates: ${range}${locked ? '' : '. Click to change'}` : 'Add a start date'}
      aria-disabled={locked || undefined}
      onClick={() => {
        if (locked) return
        closing.current = false
        setDraft(startDate ?? '')
      }}
    >
      <CalendarDays size={14} aria-hidden="true" />
      <span>{range || 'Add dates'}</span>
    </button>
  )
}
