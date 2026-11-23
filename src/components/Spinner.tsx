import './Spinner.css'

interface SpinnerProps {
  size?: number
  /** Announced to screen readers. Without it the spinner is decorative. */
  label?: string
  className?: string
}

export function Spinner({ size = 16, label, className }: SpinnerProps) {
  return (
    <span
      className={['spinner', className].filter(Boolean).join(' ')}
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="spinner__track" cx="12" cy="12" r="9" strokeWidth="3" />
        <circle className="spinner__arc" cx="12" cy="12" r="9" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  )
}
