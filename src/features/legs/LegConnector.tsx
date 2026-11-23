import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { RotateCw } from 'lucide-react'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { formatDistance, formatDuration } from '../../lib/format'
import { MODES } from '../../lib/modes'
import { effectiveDurationS } from '../../lib/routeKey'
import { useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import { getMap } from '../map/mapInstance'
import { useLegRoutes, type LegRouteInfo } from '../routing/legRoutes'
import { fitMapToLeg } from '../routing/mapFit'
import { retryRoute } from '../routing/routeManager'
import { displayName } from '../places/names'
import { MODE_ICONS } from './modeIcons'
import './legs.css'

/** Select a leg and show it on the map (below the sidebar breakpoint the slide-over gives way to the map). */
function activateLeg(legId: string): void {
  const ui = useUiStore.getState()
  ui.selectLeg(legId)
  fitMapToLeg(legId)
  if (getMap() && window.matchMedia('(max-width: 767px)').matches) ui.setSidebarOpen(false)
}

/** "312 km · 3 h 40 min" for a routed leg; the dash placeholders only appear for an unusable route. */
function summaryText(info: LegRouteInfo): string {
  const seconds = effectiveDurationS(info.leg, info.route)
  return `${formatDistance(info.route?.distanceM ?? NaN)} · ${formatDuration(seconds ?? NaN)}`
}

function LegSummary({ info, selected }: { info: LegRouteInfo; selected: boolean }) {
  const { leg, status } = info
  const meta = MODES[leg.mode]
  const Icon = MODE_ICONS[leg.mode]
  const from = displayName(info.from.name)
  const to = displayName(info.to.name)

  let text: ReactNode
  let spoken: string
  if (status === 'loading') {
    text = (
      <span className="leg-summary__text leg-summary__text--pending">
        <Spinner size={14} />
        Routing…
      </span>
    )
    spoken = 'routing'
  } else if (status === 'error') {
    text = <span className="leg-summary__text leg-summary__text--error">{info.error ?? 'Routing failed'}</span>
    spoken = 'routing failed'
  } else {
    const summary = summaryText(info)
    text = (
      <span className="leg-summary__text" data-testid="leg-summary-text">
        {summary}
        {leg.mode === 'drive' && leg.straight ? <span className="leg-summary__tag">straight line</span> : null}
      </span>
    )
    spoken = summary
  }

  return (
    <button
      type="button"
      className="leg-summary"
      data-testid="leg-summary"
      aria-pressed={selected}
      aria-label={`${meta.label} from ${from} to ${to}: ${spoken}. Show on map.`}
      onClick={() => activateLeg(leg.id)}
    >
      <span className="leg-summary__icon" aria-hidden="true">
        <Icon size={14} strokeWidth={2.25} />
      </span>
      {text}
    </button>
  )
}

/**
 * The connection between place `legIndex` and the one after it, drawn between their rows in the
 * sidebar: a rail joining the two badges with the leg's summary on it — mode icon, distance and
 * duration, a spinner while routing, or the error with its two ways out. Hover and selection are
 * shared with the map. A selected leg will grow its mode editor below the summary (the marked slot
 * in the markup); everything the connector shows comes from `useLegRoutes()`.
 */
export function LegConnector({ legIndex }: { legIndex: number }) {
  const info = useLegRoutes()[legIndex]
  const legId = info?.leg.id
  const hovered = useUiStore((s) => legId !== undefined && s.hoveredLegId === legId)
  const selected = useUiStore((s) => legId !== undefined && s.selectedLegId === legId)
  const ref = useRef<HTMLDivElement>(null)

  // A leg selected on the map: bring its connector into view.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!info) return <div className="leg-connector" data-testid="leg-connector" data-leg-index={legIndex} />

  const mode = info.leg.mode
  return (
    <div
      ref={ref}
      className="leg-connector"
      data-testid="leg-connector"
      data-leg-index={legIndex}
      data-leg-id={legId}
      data-mode={mode}
      data-status={info.status}
      data-hovered={hovered || undefined}
      data-selected={selected || undefined}
      style={{ '--leg-color': MODES[mode].color } as CSSProperties}
      // Mouse only: after a touch tap there is no pointer to leave again, so it would stay stuck.
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') useUiStore.getState().hoverLeg(info.leg.id)
      }}
      onPointerLeave={() => {
        if (useUiStore.getState().hoveredLegId === info.leg.id) useUiStore.getState().hoverLeg(null)
      }}
    >
      <LegSummary info={info} selected={selected} />

      {info.status === 'error' ? (
        <div className="leg-connector__actions">
          <Button size="sm" variant="secondary" icon={<RotateCw size={14} />} onClick={() => retryRoute(info.key)} data-testid="leg-retry">
            Retry
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => useTripStore.getState().updateLeg(info.leg.id, { straight: true })}
            data-testid="leg-straight"
          >
            Use straight line
          </Button>
        </div>
      ) : null}

      {/* F3: the mode editor of the selected leg expands here. */}
    </div>
  )
}
