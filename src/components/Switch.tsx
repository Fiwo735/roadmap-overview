import type { ReactNode } from 'react'
import './Switch.css'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Visible text; also the accessible name. */
  children: ReactNode
  disabled?: boolean
  'data-testid'?: string
}

/** An on/off switch with its label (a `role="switch"` button: Space and Enter toggle it). */
export function Switch({ checked, onChange, children, disabled, 'data-testid': testId }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className="switch"
      data-testid={testId}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      <span className="switch__label">{children}</span>
    </button>
  )
}
