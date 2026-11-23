import { modesInUse } from '../../lib/legModes'
import { CASING_EDGE, haloDash, MODES } from '../../lib/modes'
import type { LegMode } from '../../types/trip'
import { useLegRoutes } from '../routing/legRoutes'
import { MODE_ICONS } from './modeIcons'
import './legend.css'

/** A short sample of the mode's line on the map: colour, casing and dash pattern. */
function LineSample({ mode }: { mode: LegMode }) {
  const { color, casing, weight, dashArray } = MODES[mode]
  const halo = dashArray ? haloDash(dashArray) : null
  return (
    <svg className="map-legend__line" width="34" height="12" viewBox="0 0 34 12" aria-hidden="true">
      {casing ? (
        <line
          x1="2"
          y1="6"
          x2="32"
          y2="6"
          stroke={casing}
          strokeWidth={weight + 2 * CASING_EDGE}
          strokeLinecap={halo ? 'butt' : 'round'}
          strokeDasharray={halo?.dashArray}
          strokeDashoffset={halo?.dashOffset}
        />
      ) : null}
      <line
        x1="2"
        y1="6"
        x2="32"
        y2="6"
        stroke={color}
        strokeWidth={weight}
        strokeDasharray={dashArray ?? undefined}
        strokeLinecap={dashArray ? 'butt' : 'round'}
      />
    </svg>
  )
}

/**
 * Map legend (bottom-left, above the scale): the modes the trip uses, each with a sample of its line.
 * Only shown when there is more than one — a trip that is all road needs no key. A ferry crossing inside
 * a drive route counts as ferry.
 */
export function LegLegend() {
  const modes = modesInUse(useLegRoutes())
  if (modes.length < 2) return null
  return (
    <div className="map-legend" role="group" aria-label="Legend" data-testid="map-legend">
      <ul className="map-legend__list">
        {modes.map((mode) => {
          const Icon = MODE_ICONS[mode]
          return (
            <li key={mode} className="map-legend__item" data-mode={mode}>
              <LineSample mode={mode} />
              <Icon size={14} strokeWidth={2.25} aria-hidden="true" />
              <span>{MODES[mode].label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
