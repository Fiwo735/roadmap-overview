import { useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import './SegmentedControl.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  /** Colour of the icon and text while this option is selected (default: the accent). */
  color?: string
}

interface SegmentedControlProps<T extends string> {
  /** Accessible name of the group. */
  label: string
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  className?: string
}

/**
 * A row of mutually exclusive choices (a radio group drawn as one segmented bar) with manual
 * activation: the arrow keys (and Home/End) only move the focus, and Enter, Space or a click chooses.
 * Choosing can be expensive (an undo step, a routing request), so merely passing over an option on
 * the way to another must not do it. One tab stop, which follows the focus while it is inside.
 */
export function SegmentedControl<T extends string>({ label, value, options, onChange, className }: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  // The option holding the tab stop: the focused one while focus is inside, else the chosen one.
  const [focused, setFocused] = useState<T | null>(null)

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const at = Math.max(0, options.findIndex((o) => o.value === (focused ?? value)))
    let next: number
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % options.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + options.length) % options.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = options.length - 1
    else return
    e.preventDefault()
    refs.current[next]?.focus()
  }

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setFocused(null)
  }

  return (
    <div role="radiogroup" aria-label={label} className={['segmented', className].filter(Boolean).join(' ')} onKeyDown={onKeyDown} onBlur={onBlur}>
      {options.map((option, i) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={option.value === (focused ?? value) ? 0 : -1}
            className="segmented__option"
            style={option.color ? ({ '--segment-color': option.color } as CSSProperties) : undefined}
            onFocus={() => setFocused(option.value)}
            onClick={() => {
              if (!checked) onChange(option.value)
            }}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
