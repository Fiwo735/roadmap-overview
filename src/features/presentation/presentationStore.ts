import { create } from 'zustand'
import { useUiStore } from '../../store/uiStore'

/**
 * Presentation mode: the sidebar and every editing affordance are gone, so the map, the title card and the
 * ride fill the window (for showing a trip to others, and what a presentation link opens). It is not trip
 * data: not undoable, not saved. Editing surfaces ask `isEditingLocked()` (features/ride/rideStore.ts),
 * which is true while this is on.
 */
export const usePresentationStore = create<{ on: boolean }>()(() => ({ on: false }))

export const isPresenting = (): boolean => usePresentationStore.getState().on

/** `?present` in the address makes a reload present again: leaving the mode takes it out. */
function forgetPresentInAddress(): void {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('present')) return
    url.searchParams.delete('present')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  } catch {
    // The address is cosmetic here.
  }
}

export function enterPresentation(): void {
  if (isPresenting()) return
  // What the sidebar kept open (a row's search, a rename, the leg editor, the phone slide-over) goes with it.
  const ui = useUiStore.getState()
  ui.expandPlace(null)
  ui.renamePlace(null)
  ui.selectLeg(null)
  ui.selectPlace(null)
  ui.setSidebarOpen(false)
  usePresentationStore.setState({ on: true })
}

export function exitPresentation(): void {
  if (!isPresenting()) return
  usePresentationStore.setState({ on: false })
  forgetPresentInAddress()
}

export function togglePresentation(): void {
  if (isPresenting()) exitPresentation()
  else enterPresentation()
}
