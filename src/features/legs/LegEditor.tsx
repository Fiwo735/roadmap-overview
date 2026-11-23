import { useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { MapPin, RotateCcw, Undo2 } from 'lucide-react'
import { Button } from '../../components/Button'
import { SegmentedControl, type SegmentedOption } from '../../components/SegmentedControl'
import { Switch } from '../../components/Switch'
import { formatDuration } from '../../lib/format'
import { MODES, MODE_ORDER } from '../../lib/modes'
import { effectiveDurationS } from '../../lib/routeKey'
import { parseDurationMin } from '../../lib/trip'
import type { LegMode } from '../../types/trip'
import { displayName } from '../places/names'
import type { LegRouteInfo } from '../routing/legRoutes'
import { resetLegShape, setFollowRoads, setLegDurationMin, setLegLabel, setLegMode, showLegOnMap } from './legActions'
import { MODE_ICONS } from './modeIcons'

const MODE_OPTIONS: readonly SegmentedOption<LegMode>[] = MODE_ORDER.map((mode) => {
  const Icon = MODE_ICONS[mode]
  return { value: mode, label: MODES[mode].label, icon: <Icon size={14} strokeWidth={2.25} aria-hidden="true" />, color: MODES[mode].color }
})

interface Draft<T> {
  value: T
  /** What the field showed when the draft started: a draft whose source changed underneath is dropped. */
  from: unknown
}

/**
 * Duration: the routed or estimated time, which the user can override in hours and minutes. Typing is
 * free; the value is committed on Enter or when focus leaves both boxes, as ONE undo step. Anything
 * that is not a positive whole number of minutes reverts.
 */
function DurationField({ info }: { info: LegRouteInfo }) {
  const { leg, route } = info
  const seconds = effectiveDurationS(leg, route)
  const minutes = seconds === undefined ? null : Math.round(seconds / 60)
  const overridden = leg.durationMin !== undefined

  const [draft, setDraftState] = useState<Draft<{ h: string; m: string }> | null>(null)
  const latest = useRef<Draft<{ h: string; m: string }> | null>(null)
  const setDraft = (value: { h: string; m: string } | null) => {
    latest.current = value && { value, from: minutes }
    setDraftState(latest.current)
  }
  const current = draft && draft.from === minutes ? draft.value : null
  const shown = current ?? { h: minutes === null ? '' : String(Math.floor(minutes / 60)), m: minutes === null ? '' : String(minutes % 60) }

  function commit() {
    const pending = latest.current
    setDraft(null)
    if (!pending || pending.from !== minutes) return
    const parsed = parseDurationMin(pending.value.h, pending.value.m)
    if (parsed !== null && parsed !== minutes) setLegDurationMin(leg.id, parsed)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      // Revert; the connector closes the editor.
      setDraft(null)
    }
  }
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) commit()
  }

  const hint = overridden
    ? route
      ? `Estimate: ${formatDuration(route.durationS)}`
      : 'Set by you'
    : !route
      ? 'Waiting for the route…'
      : route.source !== 'osrm'
        ? 'Estimated from the distance'
        : route.spans?.some((span) => span.mode === 'ferry')
          ? 'Travel time from the route (incl. ferry)'
          : 'Driving time from the route'

  const box = (part: 'h' | 'm', label: string, unit: string, max: number) => (
    <label className="leg-editor__unit">
      <input
        className="leg-editor__number"
        data-testid={part === 'h' ? 'leg-duration-h' : 'leg-duration-min'}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={max}
        aria-label={label}
        value={shown[part]}
        placeholder="–"
        onChange={(e) => setDraft({ ...shown, [part]: e.target.value })}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={onKeyDown}
      />
      <span aria-hidden="true">{unit}</span>
    </label>
  )

  return (
    <div className="leg-editor__field" role="group" aria-label="Duration" onBlur={onBlur}>
      <span className="leg-editor__caption" aria-hidden="true">
        Duration
      </span>
      <div className="leg-editor__duration">
        {box('h', 'Duration, hours', 'h', 4)}
        {box('m', 'Duration, minutes', 'min', 5)}
      </div>
      <div className="leg-editor__hint-row">
        <span className="leg-editor__hint" data-testid="leg-duration-hint">
          {hint}
        </span>
        {overridden ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw size={14} />}
            onClick={() => setLegDurationMin(leg.id, undefined)}
            data-testid="leg-duration-reset"
          >
            Reset to estimate
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Free-text label of the leg ("Brittany Ferries · Portsmouth → Santander"): Enter or blur saves, Escape reverts. */
function LabelField({ info }: { info: LegRouteInfo }) {
  const saved = info.leg.label ?? ''
  const [draft, setDraftState] = useState<Draft<string> | null>(null)
  const latest = useRef<Draft<string> | null>(null)
  const setDraft = (value: string | null) => {
    latest.current = value === null ? null : { value, from: saved }
    setDraftState(latest.current)
  }
  const shown = draft && draft.from === saved ? draft.value : saved

  function commit() {
    const pending = latest.current
    setDraft(null)
    if (pending && pending.from === saved && pending.value.trim() !== saved) setLegLabel(info.leg.id, pending.value)
  }

  return (
    <label className="leg-editor__field">
      <span className="leg-editor__caption">Label</span>
      <input
        className="leg-editor__text"
        data-testid="leg-label-input"
        type="text"
        autoComplete="off"
        maxLength={120}
        placeholder="e.g. Brittany Ferries · Portsmouth → Santander"
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            setDraft(null)
          }
        }}
      />
    </label>
  )
}

/**
 * The selected leg's editor, shown under its summary in the sidebar: travel mode, "Follow roads" for
 * drives, duration override, label, "Show on map" and "Reset shape" once the line has been reshaped.
 * Every change is one undo step. "Show on map" fits the map to the leg (closing the mobile
 * slide-over). Escape (handled by the connector around it) reverts a field being edited and closes it.
 */
export function LegEditor({ info, id }: { info: LegRouteInfo; id: string }) {
  const { leg } = info
  return (
    <div
      className="leg-editor"
      id={id}
      role="group"
      aria-label={`Edit the leg from ${displayName(info.from.name)} to ${displayName(info.to.name)}`}
      data-testid="leg-editor"
    >
      <SegmentedControl label="Travel mode" value={leg.mode} options={MODE_OPTIONS} onChange={(mode) => setLegMode(leg.id, mode)} />
      {leg.mode === 'drive' ? (
        <Switch checked={leg.straight !== true} onChange={(follow) => setFollowRoads(leg.id, follow)} data-testid="leg-follow-roads">
          Follow roads
        </Switch>
      ) : null}
      <DurationField info={info} />
      <LabelField info={info} />
      <div className="leg-editor__actions">
        <Button size="sm" variant="ghost" icon={<MapPin size={14} />} onClick={() => showLegOnMap(leg.id)} data-testid="leg-show-on-map">
          Show on map
        </Button>
        {leg.via.length > 0 ? (
          <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} onClick={() => resetLegShape(leg.id)} data-testid="leg-reset-shape">
            Reset shape
          </Button>
        ) : null}
      </div>
    </div>
  )
}
