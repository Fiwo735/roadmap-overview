import { getMap } from '../map/mapInstance'
import { fitMapToPlaces } from '../map/view'
import { useTripStore } from '../../store/tripStore'
import { getLegRoutes } from './legRoutes'

/** Show the whole trip: every place and every point of the routes (empty trip: the default view). */
export function fitMapToTrip(animate = true): void {
  const map = getMap()
  if (!map) return
  const points = [...useTripStore.getState().trip.places, ...getLegRoutes().flatMap((info) => info.coords)]
  fitMapToPlaces(map, points, animate)
}

/** Show one leg (its places and its whole line). */
export function fitMapToLeg(legId: string, animate = true): void {
  const map = getMap()
  const info = getLegRoutes().find((i) => i.leg.id === legId)
  if (map && info) fitMapToPlaces(map, info.coords, animate)
}
