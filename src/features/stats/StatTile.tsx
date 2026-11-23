import type { ReactNode } from 'react'
import { useTooltip } from '../../components/Tooltip'

interface StatTileProps {
  /** Stable name for tests and styling: `data-testid="stat-<id>"`. */
  id: string
  label: string
  icon: ReactNode
  value: ReactNode
  /** More detail, as a tooltip (mouse hover, keyboard focus) and for screen readers; makes the tile focusable. */
  detail?: string
  /** The number is incomplete because routes are still arriving. */
  partial?: boolean
  wide?: boolean
  children?: ReactNode
}

/** One figure of the statistics card. */
export function StatTile({ id, label, icon, value, detail, partial, wide, children }: StatTileProps) {
  const tip = useTooltip<HTMLDivElement>(detail)
  return (
    <div
      className={['stat', wide ? 'stat--wide' : ''].filter(Boolean).join(' ')}
      data-testid={`stat-${id}`}
      data-partial={partial ? 'true' : undefined}
      tabIndex={detail ? 0 : undefined}
      {...(detail ? tip.props : {})}
    >
      <dt className="stat__label">
        <span className="stat__icon" aria-hidden="true">
          {icon}
        </span>
        {label}
      </dt>
      <dd className="stat__value">
        <span data-testid={`stat-${id}-value`}>{value}</span>
        {detail ? <span className="sr-only">. {detail}</span> : null}
        {children}
      </dd>
      {tip.tooltip}
    </div>
  )
}
