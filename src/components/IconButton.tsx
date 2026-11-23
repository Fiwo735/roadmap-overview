import type { ComponentProps, ReactNode } from 'react'
import { useTooltip } from './Tooltip'
import './IconButton.css'

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'aria-label' | 'children'> {
  /** Accessible name; also the tooltip text unless `tooltip` is given. Required. */
  label: string
  icon: ReactNode
  /** Tooltip text when it should say more than the label (e.g. include a shortcut). */
  tooltip?: string
  variant?: 'ghost' | 'secondary'
  size?: 'sm' | 'md'
}

export function IconButton({
  label,
  icon,
  tooltip,
  variant = 'ghost',
  size = 'md',
  className,
  type = 'button',
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: IconButtonProps) {
  const tip = useTooltip<HTMLButtonElement>(tooltip ?? label)
  return (
    <>
      <button
        {...rest}
        type={type}
        aria-label={label}
        className={['icon-btn', `icon-btn--${variant}`, `icon-btn--${size}`, className].filter(Boolean).join(' ')}
        onPointerEnter={(e) => {
          tip.props.onPointerEnter(e)
          onPointerEnter?.(e)
        }}
        onPointerLeave={(e) => {
          tip.props.onPointerLeave()
          onPointerLeave?.(e)
        }}
        onPointerDown={(e) => {
          tip.props.onPointerDown()
          onPointerDown?.(e)
        }}
        onFocus={(e) => {
          tip.props.onFocus(e)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          tip.props.onBlur()
          onBlur?.(e)
        }}
        onKeyDown={(e) => {
          tip.props.onKeyDown(e)
          onKeyDown?.(e)
        }}
      >
        {icon}
      </button>
      {tip.tooltip}
    </>
  )
}
