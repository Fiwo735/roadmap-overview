import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from './uiStore'

const ui = () => useUiStore.getState()

beforeEach(() => {
  useUiStore.setState({ expandedPlaceId: null, renamingPlaceId: null, selectedPlaceId: null, selectedLegId: null, showLabels: true })
})

describe('place row modes', () => {
  it('expanding a row ends a rename and vice versa; only one row is in either mode', () => {
    ui().expandPlace('a')
    expect(ui().expandedPlaceId).toBe('a')

    ui().renamePlace('b')
    expect(ui().renamingPlaceId).toBe('b')
    expect(ui().expandedPlaceId).toBeNull()

    ui().expandPlace('c')
    expect(ui().expandedPlaceId).toBe('c')
    expect(ui().renamingPlaceId).toBeNull()
  })

  it('closing one mode leaves the other alone', () => {
    ui().expandPlace('a')
    ui().renamePlace(null)
    expect(ui().expandedPlaceId).toBe('a')
    ui().expandPlace(null)
    expect(ui().expandedPlaceId).toBeNull()
  })
})

describe('selection', () => {
  it('selects one thing at a time: a place or a leg', () => {
    ui().selectPlace('p1')
    ui().selectLeg('l1')
    expect(ui().selectedLegId).toBe('l1')
    expect(ui().selectedPlaceId).toBeNull()
    ui().selectPlace('p2')
    expect(ui().selectedPlaceId).toBe('p2')
    expect(ui().selectedLegId).toBeNull()
  })

  it('clearing one selection leaves the other alone', () => {
    ui().selectLeg('l1')
    ui().selectPlace(null)
    expect(ui().selectedLegId).toBe('l1')
    ui().selectLeg(null)
    expect(ui().selectedLegId).toBeNull()
  })
})

describe('map tools', () => {
  it('shows labels by default and can hide them', () => {
    expect(ui().showLabels).toBe(true)
    ui().setShowLabels(false)
    expect(ui().showLabels).toBe(false)
  })
})
