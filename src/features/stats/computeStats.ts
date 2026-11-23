import { effectiveDays } from '../../lib/trip'
import { effectiveDurationS } from '../../lib/routeKey'
import type { LegMode, Trip } from '../../types/trip'
import type { LegRouteInfo } from '../routing/legRoutes'
import type { Country } from './countries'

// Framework-free: the statistics card and the image export both call `computeTripStats`.

export interface TripStats {
  /** Number of places. */
  stops: number
  /** Trip length in days: effective last day − first day + 1 (0 without places). */
  days: number
  /** Total distance of the routed legs, in metres. */
  distanceM: number
  /** Distance per mode; a ferry crossing inside a drive route counts as ferry. */
  distanceByModeM: Record<LegMode, number>
  /** Number of legs per mode, routed or not yet. */
  legsByMode: Record<LegMode, number>
  /** Travel time per mode in seconds (user duration overrides applied; ferry stretches of a drive leg are ferry time). */
  timeByModeS: Record<LegMode, number>
  /** Time spent driving (`timeByModeS.drive`). */
  drivingS: number
  /** Travel time by ferry, train and flight together. */
  otherTravelS: number
  /** All travel time: driving plus the other modes. */
  travelS: number
  /** Countries visited, ordered by first visit (from `detectCountries`; empty until they are known). */
  countries: Country[]
  /** Legs whose route is not known yet (still routing or failed): the numbers above leave them out. */
  pendingLegs: number
  loadingLegs: number
  failedLegs: number
}

const byMode = (): Record<LegMode, number> => ({ drive: 0, ferry: 0, train: 0, flight: 0 })

/**
 * Statistics of a trip. `legs` is the route accessor's output (`getLegRoutes()`); `countries` comes
 * from the asynchronous `detectCountries` and is passed through. Legs without a route yet add no
 * distance, and no time either unless the user gave them a duration (then that duration counts, for
 * the leg's own mode); `pendingLegs` says how many are missing so the UI can mark the numbers partial.
 */
export function computeTripStats(trip: Pick<Trip, 'places'>, legs: readonly LegRouteInfo[], countries: readonly Country[] = []): TripStats {
  const distanceByModeM = byMode()
  const timeByModeS = byMode()
  const legsByMode = byMode()
  let loadingLegs = 0
  let failedLegs = 0

  for (const { leg, route, status } of legs) {
    legsByMode[leg.mode]++
    if (status === 'loading') loadingLegs++
    else if (status === 'error') failedLegs++

    const durationS = effectiveDurationS(leg, route)
    if (!route) {
      if (durationS !== undefined) timeByModeS[leg.mode] += durationS
      continue
    }
    const total = durationS ?? route.durationS

    // A routed drive leg may contain ferry crossings (spans). The user's duration override is for the
    // whole leg, so the spans' durations are scaled to add up to it.
    const ferrySpans = leg.mode === 'drive' ? (route.spans ?? []).filter((s) => s.mode === 'ferry') : []
    if (ferrySpans.length === 0) {
      distanceByModeM[leg.mode] += route.distanceM
      timeByModeS[leg.mode] += total
      continue
    }
    const spanSumS = (route.spans ?? []).reduce((sum, s) => sum + s.durationS, 0)
    const ferryDistanceM = Math.min(route.distanceM, ferrySpans.reduce((sum, s) => sum + s.distanceM, 0))
    const ferryS = spanSumS > 0 ? Math.min(total, (ferrySpans.reduce((sum, s) => sum + s.durationS, 0) * total) / spanSumS) : 0
    distanceByModeM.ferry += ferryDistanceM
    distanceByModeM.drive += route.distanceM - ferryDistanceM
    timeByModeS.ferry += ferryS
    timeByModeS.drive += total - ferryS
  }

  const days = trip.places.length === 0 ? 0 : (effectiveDays(trip.places).at(-1) as number) - trip.places[0].day + 1
  const drivingS = timeByModeS.drive
  const otherTravelS = timeByModeS.ferry + timeByModeS.train + timeByModeS.flight
  return {
    stops: trip.places.length,
    days,
    distanceM: distanceByModeM.drive + distanceByModeM.ferry + distanceByModeM.train + distanceByModeM.flight,
    distanceByModeM,
    legsByMode,
    timeByModeS,
    drivingS,
    otherTravelS,
    travelS: drivingS + otherTravelS,
    countries: [...countries],
    pendingLegs: loadingLegs + failedLegs,
    loadingLegs,
    failedLegs,
  }
}
