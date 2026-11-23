import { useEffect } from 'react'
import { Play } from 'lucide-react'
import { Button } from '../../components/Button'
import { useTooltip } from '../../components/Tooltip'
import { closeRide, rideDebug, startRide, useRideAvailability, useRideStore } from './rideStore'
import './ride.css'

const READY_TIP = 'Watch a campervan drive your route, day by day'

/**
 * Top bar: starts the ride, or closes it while one is on. With fewer than two places, or while a
 * leg is still being routed, it is disabled with the reason as its tooltip; it stays focusable
 * (aria-disabled, not `disabled`) so keyboard and screen-reader users can read why.
 */
export function RideButton() {
  const availability = useRideAvailability()
  const active = useRideStore((s) => s.active)
  const blocked = !availability.ok && !active
  const reason = availability.ok ? undefined : availability.reason
  const tip = useTooltip<HTMLButtonElement>(blocked ? reason : active ? 'Close the ride (Esc)' : READY_TIP)

  // Dev builds: tests and humans drive the ride through `window.__ROADMAP__.ride`.
  useEffect(() => {
    if (import.meta.env.DEV && window.__ROADMAP__) window.__ROADMAP__.ride = rideDebug
  }, [])

  return (
    <>
      <Button
        id="ride-button"
        className="ride-button"
        variant="primary"
        icon={<Play size={16} fill="currentColor" aria-hidden="true" />}
        aria-pressed={active}
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? 'ride-button-reason' : undefined}
        data-testid="ride-button"
        onClick={() => {
          if (blocked) return
          if (active) closeRide()
          else startRide()
        }}
        {...tip.props}
      >
        <span className="ride-button__label">Ride</span>
      </Button>
      {tip.tooltip}
      {blocked ? (
        <span id="ride-button-reason" className="sr-only">
          {reason}
        </span>
      ) : null}
    </>
  )
}
