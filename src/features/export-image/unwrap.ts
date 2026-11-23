import type { LatLng, Place } from '../../types/trip'
import type { LegRouteInfo } from '../routing/legRoutes'

// Framework-free: a trip that crosses the date line is drawn as one piece, on a map that is wider than the world.

const shiftAll = (coords: readonly LatLng[], lng: number): LatLng[] => coords.map((p) => ({ lat: p.lat, lng: p.lng + lng }))

/**
 * Which copy of the world each part of the trip is drawn on. Flight arcs run on past ±180° (their
 * longitudes stay continuous), so a trip from Tokyo over Honolulu to San Francisco has its places
 * at 140°, −158° and −122° but its lines at 140° … 202° … 238°. Walking the legs in order, this moves
 * every leg's line, and every place after the first, by whole turns of 360° so that each piece
 * starts where the one before it ended. Returns the inputs themselves when nothing moves, which is
 * almost always.
 */
export function unwrapTrip(places: readonly Place[], legs: readonly LegRouteInfo[]): { places: Place[]; legs: LegRouteInfo[] } {
  const offsets = new Map<string, number>()
  let moved = false
  const unwrapped = legs.map((info): LegRouteInfo => {
    const fromLng = info.from.lng + (offsets.get(info.from.id) ?? 0)
    const turns = Math.round((fromLng - info.coords[0].lng) / 360)
    const coords = turns === 0 ? info.coords : shiftAll(info.coords, turns * 360)
    const toOffset = 360 * Math.round((coords[coords.length - 1].lng - info.to.lng) / 360)
    offsets.set(info.to.id, toOffset)
    if (turns !== 0 || toOffset !== 0) moved = true
    return turns === 0 ? info : { ...info, coords }
  })
  if (!moved) return { places: places as Place[], legs: legs as LegRouteInfo[] }
  return { places: places.map((p) => ((offsets.get(p.id) ?? 0) === 0 ? p : { ...p, lng: p.lng + (offsets.get(p.id) as number) })), legs: unwrapped }
}
