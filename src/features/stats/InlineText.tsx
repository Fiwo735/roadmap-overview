import { useEffect, useRef, useState } from 'react'

interface InlineTextProps {
  value: string
  /** Shown (faint) while the value is empty, in the field as well. */
  placeholder: string
  /** Called once per edit with the trimmed text, on Enter or when the field loses focus. */
  onCommit: (value: string) => void
  /** Accessible name of the text and of its field. */
  label: string
  className?: string
  maxLength?: number
  /** `data-testid` of the text; its field gets `${testId}-input`. */
  testId?: string
}

/**
 * Text that is edited where it stands: shown as a button (so it can wrap over several lines and
 * keyboard users can reach it), a click or Enter turns it into a field. Typing only changes local
 * state, so the store — and the undo history — sees one change per edit. Escape discards it.
 */
export function InlineText({ value, placeholder, onCommit, label, className, maxLength = 120, testId }: InlineTextProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const display = useRef<HTMLButtonElement>(null)
  // Escape blurs the field and blur commits: this flag makes that blur discard instead.
  const cancelled = useRef(false)
  // After Enter or Escape the focus goes back to the text (a click elsewhere keeps the focus there).
  const refocus = useRef(false)
  const editing = draft !== null

  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false
      display.current?.focus()
    }
  }, [editing])

  const commit = () => {
    if (draft !== null && !cancelled.current) onCommit(draft.trim())
    cancelled.current = false
    setDraft(null)
  }

  if (editing) {
    return (
      <input
        className={['inline-text', 'inline-text--editing', className].filter(Boolean).join(' ')}
        data-testid={testId && `${testId}-input`}
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        maxLength={maxLength}
        spellCheck={false}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // Without this the Enter's keypress lands on the button the focus returns to and clicks it.
            e.preventDefault()
            refocus.current = true
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            cancelled.current = true
            refocus.current = true
            e.currentTarget.blur()
          }
        }}
      />
    )
  }

  return (
    <button
      ref={display}
      type="button"
      className={['inline-text', value ? '' : 'is-empty', className].filter(Boolean).join(' ')}
      data-testid={testId}
      aria-label={`${label}: ${value || 'not set'}. Click to edit`}
      // The text may be clamped to a few lines by the stylesheet: the full text is one hover away.
      title={value || undefined}
      onClick={() => setDraft(value)}
    >
      <span className="inline-text__text">{value || placeholder}</span>
    </button>
  )
}
