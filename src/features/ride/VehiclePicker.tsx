import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { Button } from '../../components/Button'
import { portalTarget } from '../../components/portal'
import { useTooltip } from '../../components/Tooltip'
import { COLOR_PRESETS, VEHICLE_KINDS, VEHICLES, resolveVehicle, vehicleLabel } from '../../lib/vehicles'
import { useTripStore } from '../../store/tripStore'
import { rememberVehicle } from '../../store/vehiclePreference'
import type { VehicleKind } from '../../types/trip'
import { usePresentationStore } from '../presentation/presentationStore'
import { useRideStore } from './rideStore'
import { vehicleSvg } from './vehicles'
import './vehicle.css'

/** Why the vehicle cannot be changed now, or undefined when it can. */
function useLockedReason(): string | undefined {
  const riding = useRideStore((s) => s.active)
  const presenting = usePresentationStore((s) => s.on)
  if (riding) return 'Close the ride (Esc) to change the vehicle.'
  if (presenting) return 'Leave presentation mode (Esc) to change the vehicle.'
  return undefined
}

/** A choice the user made: the trip's vehicle now (one undo step) and the one new trips start with. */
function choose(kind: VehicleKind, color?: string): void {
  useTripStore.getState().setVehicle(kind, color)
  rememberVehicle(useTripStore.getState().trip.vehicle)
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled])'

/** Move the focus within a radio group by `delta` (wrapping); the arrows only move, Enter and Space choose. */
function moveFocus(group: HTMLElement, delta: number): void {
  const items = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'))
  const at = items.indexOf(document.activeElement as HTMLElement)
  items[(Math.max(0, at) + delta + items.length) % items.length]?.focus()
}

/** The picker's panel: the vehicles with their pictures, and the body colours of the chosen one. */
function VehiclePanel({ trigger, onClose }: { trigger: HTMLElement; onClose: (returnFocus: boolean) => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const colorInput = useRef<HTMLInputElement>(null)
  const [style, setStyle] = useState<CSSProperties | null>(null)
  // A colour being tried in the browser's picker, for the vehicle it was started on.
  const [tried, setTried] = useState<{ kind: string; color: string } | null>(null)
  const id = useId()
  const vehicle = useTripStore((s) => s.trip.vehicle)
  const current = resolveVehicle(vehicle)
  const meta = VEHICLES[current.kind]
  const shown = tried?.kind === current.kind ? tried.color : current.color
  const isPreset = COLOR_PRESETS.some((c) => c.value === current.color)

  // Below the trigger, with the panel's right edge on the trigger's (it sits near the right of the top bar).
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const a = trigger.getBoundingClientRect()
    const { width } = panel.getBoundingClientRect()
    setStyle({ top: a.bottom + 6, left: Math.max(8, Math.min(a.right - width, window.innerWidth - width - 8)) })
  }, [trigger])

  // Focus goes to the chosen vehicle once the panel is in place.
  const positioned = style !== null
  useEffect(() => {
    if (positioned) panelRef.current?.querySelector<HTMLElement>('[data-group="vehicles"] [aria-checked="true"]')?.focus()
  }, [positioned])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!panelRef.current?.contains(target) && !trigger.contains(target)) onClose(false)
    }
    const onScroll = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose(false)
    }
    const close = () => onClose(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [trigger, onClose])

  // A custom colour is committed when the browser's picker is done (its `change` event), not on every
  // step of the drag (React's onChange is the `input` event): one choice is one undo step.
  useEffect(() => {
    const input = colorInput.current
    if (!input) return
    const commit = () => {
      setTried(null)
      const { kind } = resolveVehicle(useTripStore.getState().trip.vehicle)
      choose(kind, input.value)
    }
    input.addEventListener('change', commit)
    return () => input.removeEventListener('change', commit)
  }, [meta.colorable])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose(true)
      return
    }
    const target = e.target as HTMLElement
    const group = target.closest<HTMLElement>('[role="radiogroup"]')
    if (group && target.getAttribute('role') === 'radio') {
      const columns = group.dataset.group === 'vehicles' ? 2 : 1
      const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }
      if (e.key in step) {
        e.preventDefault()
        moveFocus(group, step[e.key])
        return
      }
      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault()
        moveFocus(group, e.key === 'Home' ? -999 : 999)
        return
      }
    }
    if (e.key === 'Tab') {
      const all = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      const edge = e.shiftKey ? all[0] : all[all.length - 1]
      if (target === edge) onClose(false)
    }
  }

  return (
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label="Vehicle and colour"
      className="vehicle-panel"
      data-testid="vehicle-panel"
      style={style ?? { top: 0, left: 0, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
    >
      <div role="radiogroup" aria-label="Vehicle" className="vehicle-grid" data-group="vehicles">
        {VEHICLE_KINDS.map((kind) => {
          const checked = kind === current.kind
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              className="vehicle-option"
              data-testid="vehicle-option"
              data-kind={kind}
              onClick={() => choose(kind)}
            >
              <span
                className="vehicle-option__art"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: vehicleSvg({ kind, color: checked ? shown : undefined }) }}
              />
              <span className="vehicle-option__name">{VEHICLES[kind].label}</span>
            </button>
          )
        })}
      </div>

      <div className="vehicle-colors" data-testid="vehicle-colors">
        <span className="vehicle-colors__title" id={`${id}-colors`}>
          Body colour
        </span>
        {meta.colorable ? (
          <div role="radiogroup" aria-labelledby={`${id}-colors`} className="vehicle-swatches" data-group="colors">
            {COLOR_PRESETS.map((c) => {
              const checked = c.value === current.color
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={c.label}
                  title={c.label}
                  tabIndex={checked || (!isPreset && c.value === COLOR_PRESETS[0].value) ? 0 : -1}
                  className="vehicle-swatch"
                  data-testid="vehicle-color"
                  data-color={c.value}
                  style={{ '--swatch': c.value } as CSSProperties}
                  onClick={() => choose(current.kind, c.value)}
                />
              )
            })}
            <label className="vehicle-swatch vehicle-swatch--custom" data-checked={!isPreset || undefined} title="Custom colour" style={{ '--swatch': shown } as CSSProperties}>
              <input ref={colorInput} type="color" aria-label="Custom colour" data-testid="vehicle-color-custom" value={shown} onChange={(e) => setTried({ kind: current.kind, color: e.target.value })} />
            </label>
          </div>
        ) : (
          <p className="vehicle-colors__note" data-testid="vehicle-colors-note">
            {meta.label} has a fixed colour.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Top bar, beside the Ride button: the chevron that opens the vehicle picker. The vehicle is part of the
 * trip (one undo step, saved, shared), so it cannot change while a ride runs or in presentation mode:
 * the button then says so instead of opening.
 */
export function VehiclePicker() {
  // The button the panel hangs from while it is open.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const vehicle = useTripStore((s) => s.trip.vehicle)
  const reason = useLockedReason()
  const locked = reason !== undefined
  const name = useMemo(() => vehicleLabel(vehicle), [vehicle])
  const tip = useTooltip<HTMLButtonElement>(locked ? reason : `Vehicle: ${name}`)

  // A lock that begins while the panel is open (the ride starts, `P`) closes it.
  useEffect(() => {
    const close = () => setAnchor(null)
    const stopRide = useRideStore.subscribe((s) => s.active && close())
    const stopPresentation = usePresentationStore.subscribe((s) => s.on && close())
    return () => {
      stopRide()
      stopPresentation()
    }
  }, [])

  const close = useMemo(
    () => (returnFocus: boolean) => {
      setAnchor(null)
      if (returnFocus) triggerRef.current?.focus()
    },
    [],
  )

  return (
    <>
      <Button
        ref={triggerRef}
        variant="primary"
        className="vehicle-button"
        aria-label={`Choose vehicle (currently ${name})`}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        aria-disabled={locked || undefined}
        aria-describedby={locked ? 'vehicle-button-reason' : undefined}
        data-testid="vehicle-button"
        data-vehicle-kind={resolveVehicle(vehicle).kind}
        onClick={(e) => {
          const button = e.currentTarget
          if (!locked) setAnchor((a) => (a ? null : button))
        }}
        {...tip.props}
      >
        <ChevronDown size={14} aria-hidden="true" />
      </Button>
      {tip.tooltip}
      {locked ? (
        <span id="vehicle-button-reason" className="sr-only">
          {reason}
        </span>
      ) : null}
      {anchor ? createPortal(<VehiclePanel trigger={anchor} onClose={close} />, portalTarget(anchor)) : null}
    </>
  )
}
