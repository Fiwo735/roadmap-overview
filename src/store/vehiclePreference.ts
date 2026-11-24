import { canonicalVehicle, parseVehicle } from '../lib/vehicles'
import type { Trip, TripVehicle } from '../types/trip'

/**
 * The vehicle the user chose last (`{ kind, color? }` as JSON, absent for the default campervan): the
 * vehicle a NEW trip starts with — "New trip", the empty trip of a first visit, the sample trip when it has
 * none of its own. It is a per-browser habit, not trip data: opening a file or a link keeps that trip's
 * own vehicle, and undo does not touch it (it changes only when the user picks a vehicle).
 */
export const VEHICLE_PREFERENCE_KEY = 'roadmap-overview:vehicle'

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** The remembered vehicle, or undefined (none chosen yet, unreadable, or storage blocked). */
export function preferredVehicle(): TripVehicle | undefined {
  try {
    const raw = storage()?.getItem(VEHICLE_PREFERENCE_KEY)
    return raw ? parseVehicle(JSON.parse(raw), []) : undefined
  } catch {
    return undefined
  }
}

/** Remember `vehicle` (as the trip stores it: undefined is the default campervan) for the next new trip. */
export function rememberVehicle(vehicle: TripVehicle | undefined): void {
  try {
    const canonical = vehicle && canonicalVehicle(vehicle.kind, vehicle.color)
    if (canonical) storage()?.setItem(VEHICLE_PREFERENCE_KEY, JSON.stringify(canonical))
    else storage()?.removeItem(VEHICLE_PREFERENCE_KEY)
  } catch {
    // Not remembered: the next new trip starts with the campervan.
  }
}

/** `trip` with the remembered vehicle when it has none of its own (the same object when there is nothing to add). */
export function withPreferredVehicle(trip: Trip): Trip {
  if (trip.vehicle) return trip
  const vehicle = preferredVehicle()
  return vehicle ? { ...trip, vehicle } : trip
}
