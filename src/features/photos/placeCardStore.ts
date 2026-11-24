import { create } from 'zustand'
import { isRiding } from '../ride/rideStore'

/**
 * What is open over the map for a clicked place (F11): the place card, and the photo viewer opened from it.
 * Not trip data: not undoable, not saved.
 */
export interface PlaceCardState {
  /** The place whose card is open (anchored to its marker). */
  placeId: string | null
  /** Opened with the keyboard: the card takes the focus (a click leaves it where it is). */
  focusCard: boolean
  /** Where the focus goes back to (the marker) when the card closes while it holds the focus. */
  returnFocus: (() => void) | null
  /** The photo viewer: which place's photos, and which one is showing. */
  viewer: { placeId: string; index: number } | null
}

export const usePlaceCardStore = create<PlaceCardState>()(() => ({ placeId: null, focusCard: false, returnFocus: null, viewer: null }))

/** Open the card of a place the user clicked on the map. Not during a ride: the camera is busy and the card would swim. */
export function openPlaceCard(placeId: string, { byKeyboard = false, returnFocus = null }: { byKeyboard?: boolean; returnFocus?: (() => void) | null } = {}): void {
  if (isRiding()) return
  usePlaceCardStore.setState({ placeId, focusCard: byKeyboard, returnFocus })
}

export function closePlaceCard(): void {
  const { placeId, returnFocus } = usePlaceCardStore.getState()
  if (placeId === null) return
  const hadFocus = globalThis.document?.activeElement?.closest('.map-place-card') != null
  usePlaceCardStore.setState({ placeId: null, focusCard: false, returnFocus: null })
  // A keyboard user who closes the card goes back to the marker they opened it from.
  if (hadFocus) returnFocus?.()
}

export function openViewer(placeId: string, index: number): void {
  usePlaceCardStore.setState({ viewer: { placeId, index } })
}

export function showViewerPhoto(index: number): void {
  const { viewer } = usePlaceCardStore.getState()
  if (viewer) usePlaceCardStore.setState({ viewer: { ...viewer, index } })
}

export function closeViewer(): void {
  if (usePlaceCardStore.getState().viewer !== null) usePlaceCardStore.setState({ viewer: null })
}
