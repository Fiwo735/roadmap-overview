import { toast } from '../../components/toast'
import { isAbortError } from '../../lib/requestQueue'
import { reverseGeocode } from '../../services/nominatim'
import { useTripStore, withoutHistory } from '../../store/tripStore'
import { DROPPED_PIN_NAME } from './names'

const inFlight = new Map<string, AbortController>()

/**
 * Name a machine-named place after what is at its coordinates (a dropped pin, a dragged marker).
 * Runs in the background after the user's gesture: the answer is applied with undo history paused,
 * so it never becomes an undo step of its own, and only if the place is still where and what it was
 * when we asked (it may have been moved, renamed, deleted or undone meanwhile).
 */
export function lookupName(placeId: string): void {
  const asked = useTripStore.getState().trip.places.find((p) => p.id === placeId)
  if (!asked || asked.customName) return

  inFlight.get(placeId)?.abort()
  const controller = new AbortController()
  inFlight.set(placeId, controller)

  const unchanged = () => {
    const now = useTripStore.getState().trip.places.find((p) => p.id === placeId)
    const same = now && now.lat === asked.lat && now.lng === asked.lng && now.name === asked.name && !now.customName
    return same ? now : undefined
  }

  reverseGeocode({ lat: asked.lat, lng: asked.lng }, { signal: controller.signal })
    .then((result) => {
      if (!unchanged()) return
      // Nothing known there (open sea): the old name would be wrong, so fall back to the pin name.
      const patch = result
        ? { name: result.name || DROPPED_PIN_NAME, address: result.address }
        : { name: DROPPED_PIN_NAME, address: undefined }
      withoutHistory(() => useTripStore.getState().updatePlace(placeId, patch))
    })
    .catch((error: unknown) => {
      if (isAbortError(error)) return
      if (unchanged()) toast.error("Couldn't look up a name for that spot. You can rename it yourself.")
    })
    .finally(() => {
      if (inFlight.get(placeId) === controller) inFlight.delete(placeId)
    })
}
