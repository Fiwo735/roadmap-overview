import { MAX_CAPTION_LENGTH, movePhoto } from '../../lib/photos'
import { useTripStore } from '../../store/tripStore'
import type { PlacePhoto } from '../../types/trip'
import { isEditingLocked } from '../ride/rideStore'

/** Each of these is ONE undo step, and does nothing while editing is locked (ride, presentation mode). */

function photosOf(placeId: string): PlacePhoto[] | null {
  if (isEditingLocked()) return null
  return useTripStore.getState().trip.places.find((p) => p.id === placeId)?.photos ?? null
}

export function removePhoto(placeId: string, photoId: string): void {
  const photos = photosOf(placeId)
  if (!photos) return
  useTripStore.getState().updatePlace(placeId, { photos: photos.filter((p) => p.id !== photoId) })
}

/** Move a photo one place earlier (`-1`) or later (`1`). */
export function shiftPhoto(placeId: string, photoId: string, delta: -1 | 1): void {
  const photos = photosOf(placeId)
  if (!photos) return
  useTripStore.getState().updatePlace(placeId, { photos: movePhoto(photos, photos.findIndex((p) => p.id === photoId), delta) })
}

/** Set (or, when blank, remove) the caption of a photo. */
export function setCaption(placeId: string, photoId: string, text: string): void {
  const photos = photosOf(placeId)
  if (!photos) return
  const caption = text.trim().slice(0, MAX_CAPTION_LENGTH)
  useTripStore.getState().updatePlace(placeId, {
    photos: photos.map((p) => {
      if (p.id !== photoId) return p
      const { caption: _old, ...rest } = p
      return caption ? { ...rest, caption } : rest
    }),
  })
}
