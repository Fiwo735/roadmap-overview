import { useTripStore } from '../../store/tripStore'
import './legs.css'

/**
 * The connection between place `legIndex` and the one after it, drawn between their rows in the
 * sidebar. For now only a slim vertical line; the leg summary (distance, time, mode editor) is
 * built on this component later, so it stays self-contained.
 */
export function LegConnector({ legIndex }: { legIndex: number }) {
  const legId = useTripStore((s) => s.trip.legs[legIndex]?.id)
  return <div className="leg-connector" data-testid="leg-connector" data-leg-index={legIndex} data-leg-id={legId} />
}
