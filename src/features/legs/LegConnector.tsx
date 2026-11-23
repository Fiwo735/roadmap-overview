import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { RotateCw } from 'lucide-react'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { formatDistance, formatDuration } from '../../lib/format'
import { MODES } from '../../lib/modes'
import { effectiveDurationS } from '../../lib/routeKey'
import { useUiStore } from '../../store/uiStore'
import { isTextEntry } from '../layout/shortcuts'
import { useLegRoutes, type LegRouteInfo } from '../routing/legRoutes'
import { fitMapToLeg } from '../routing/mapFit'
import { retryRoute } from '../routing/routeManager'
import { displayName } from '../places/names'
import { LegEditor } from './LegEditor'
import { setFollowRoads } from './legActions'
import { MODE_ICONS } from './modeIcons'
import './legs.css'

/**
 * Select a leg (which opens its editor in the connector) and fit the map to it. The mobile slide-over
 * stays open, because the editor is in it: its "Show on map" button closes it (`showLegOnMap`).
 */
function activateLeg(legId: string): void {
  useUiStore.getState().selectLeg(legId)
  fitMapToLeg(legId)
}

/** "312 km · 3 h 40 min" for a routed leg; the dash placeholders only appear for an unusable route. */
function summaryText(info: LegRouteInfo): string {
  const seconds = effectiveDurationS(info.leg, info.route)
  return `${formatDistance(info.route?.distanceM ?? NaN)} · ${formatDuration(seconds ?? NaN)}`
}

function LegSummary({ info, selected, editorId }: { info: LegRouteInfo; selected: boolean; editorId: string }) {
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
        {leg.mode === 'drive' && info.route?.spans?.some((s) => s.mode === 'ferry') ? (
          <span className="leg-summary__tag" data-testid="leg-ferry-tag">
            incl. ferry
          </span>
        ) : null}
      </span>
    )
    spoken = summary
  }

  return (
    <button
      type="button"
      className="leg-summary"
      data-testid="leg-summary"
      aria-expanded={selected}
      aria-controls={selected ? editorId : undefined}
      aria-label={`${meta.label} from ${from} to ${to}${leg.label ? ` (${leg.label})` : ''}: ${spoken}. Select to edit it.`}
      onClick={() => activateLeg(leg.id)}
    >
      <span className="leg-summary__icon" aria-hidden="true">
        <Icon size={14} strokeWidth={2.25} />
      </span>
      <span className="leg-summary__body">
        {leg.label ? (
          <span className="leg-summary__label" data-testid="leg-label">
            {leg.label}
          </span>
        ) : null}
        {text}
      </span>
    </button>
  )
}

/**
 * The connection between place `legIndex` and the one after it, drawn between their rows in the
 * sidebar: a rail joining the two badges with the leg's summary on it — mode icon, label, distance and
 * duration, a spinner while routing, or the error with its two ways out. Hover and selection are
 * shared with the map. The selected leg grows its editor (`LegEditor`) below the summary; Escape or a
 * click elsewhere in the sidebar collapses it. Everything the connector shows comes from `useLegRoutes()`.
 */
export function LegConnector({ legIndex }: { legIndex: number }) {
  const info = useLegRoutes()[legIndex]
  const legId = info?.leg.id
  const hovered = useUiStore((s) => legId !== undefined && s.hoveredLegId === legId)
  const selected = useUiStore((s) => legId !== undefined && s.selectedLegId === legId)
  const ref = useRef<HTMLDivElement>(null)

  // A leg selected on the map: bring its connector into view (the editor included once it is open).
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  // The editor closes on a click elsewhere in the sidebar (the map's own click clears the selection
  // there). On `click`, not on press: closing moves the rows below, which must not happen between
  // the press and the release of a click on one of them.
  useEffect(() => {
    if (!selected) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element
      if (ref.current?.contains(target) || !target.closest('.sidebar')) return
      useUiStore.getState().selectLeg(null)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [selected])

  // Escape with the focus elsewhere (typically left on the map after clicking a line) closes it too,
  // unless something else — a menu, a drag, a dialog — already used the key, or the focus is in some
  // other field (the trip title, a place's name or day), where Escape belongs to that field.
  useEffect(() => {
    if (!selected) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isTextEntry(e.target) || document.querySelector('dialog[open]')) return
      useUiStore.getState().selectLeg(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected])

  const collapse = () => {
    useUiStore.getState().selectLeg(null)
    ref.current?.querySelector<HTMLElement>('[data-testid="leg-summary"]')?.focus()
  }

  if (!info) return <div className="leg-connector" data-testid="leg-connector" data-leg-index={legIndex} />

  const mode = info.leg.mode
  const editorId = `leg-editor-${info.leg.id}`
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
      onKeyDown={(e) => {
        // Escape inside the connector (its editor, or the summary) closes the editor. Stopped here:
        // it must not also close the mobile slide-over behind it.
        if (e.key !== 'Escape' || !selected || e.defaultPrevented) return
        e.stopPropagation()
        collapse()
      }}
      // Mouse only: after a touch tap there is no pointer to leave again, so it would stay stuck.
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') useUiStore.getState().hoverLeg(info.leg.id)
      }}
      onPointerLeave={() => {
        if (useUiStore.getState().hoveredLegId === info.leg.id) useUiStore.getState().hoverLeg(null)
      }}
    >
      <LegSummary info={info} selected={selected} editorId={editorId} />

      {info.status === 'error' ? (
        <div className="leg-connector__actions">
          <Button size="sm" variant="secondary" icon={<RotateCw size={14} />} onClick={() => retryRoute(info.key)} data-testid="leg-retry">
            Retry
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setFollowRoads(info.leg.id, false)}
            data-testid="leg-straight"
          >
            Use straight line
          </Button>
        </div>
      ) : null}

      {selected ? <LegEditor info={info} id={editorId} /> : null}
    </div>
  )
}
