import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from '../../store/uiStore'
import { editingLockedReason, isEditingLocked, useRideStore } from '../ride/rideStore'
import { enterPresentation, exitPresentation, isPresenting, togglePresentation, usePresentationStore } from './presentationStore'

beforeEach(() => {
  usePresentationStore.setState({ on: false })
  useRideStore.setState({ active: false })
  useUiStore.setState({ expandedPlaceId: null, renamingPlaceId: null, selectedPlaceId: null, selectedLegId: null, sidebarOpen: false })
})

describe('presentation mode', () => {
  it('toggles on and off', () => {
    expect(isPresenting()).toBe(false)
    togglePresentation()
    expect(isPresenting()).toBe(true)
    togglePresentation()
    expect(isPresenting()).toBe(false)
  })

  it('is one of the reasons editing is locked, together with the ride', () => {
    expect(isEditingLocked()).toBe(false)
    enterPresentation()
    expect(isEditingLocked()).toBe(true)
    exitPresentation()
    expect(isEditingLocked()).toBe(false)

    useRideStore.setState({ active: true })
    expect(isEditingLocked()).toBe(true)
    enterPresentation()
    exitPresentation()
    // Leaving presentation mode must not unlock a ride that is still running.
    expect(isEditingLocked()).toBe(true)
  })

  it('closes what the sidebar kept open when it begins', () => {
    useUiStore.setState({ expandedPlaceId: 'a', selectedPlaceId: 'a', sidebarOpen: true })
    enterPresentation()
    const ui = useUiStore.getState()
    expect(ui.expandedPlaceId).toBeNull()
    expect(ui.selectedPlaceId).toBeNull()
    expect(ui.sidebarOpen).toBe(false)

    useUiStore.setState({ renamingPlaceId: 'a', selectedLegId: 'l' })
    exitPresentation()
    enterPresentation()
    expect(useUiStore.getState().renamingPlaceId).toBeNull()
    expect(useUiStore.getState().selectedLegId).toBeNull()
  })

  it('entering and leaving twice changes nothing more', () => {
    enterPresentation()
    enterPresentation()
    expect(isPresenting()).toBe(true)
    exitPresentation()
    exitPresentation()
    expect(isPresenting()).toBe(false)
  })

  it('says why the trip cannot be changed, for the toast actions that check at click time', () => {
    expect(editingLockedReason()).toBeNull()
    enterPresentation()
    expect(editingLockedReason()).toMatch(/Leave presentation mode/)
    exitPresentation()
    useRideStore.setState({ active: true })
    expect(editingLockedReason()).toMatch(/Close the ride/)
    enterPresentation()
    expect(editingLockedReason()).toMatch(/Leave presentation mode and close the ride/)
    exitPresentation()
    useRideStore.setState({ active: false })
    expect(editingLockedReason()).toBeNull()
  })
})
