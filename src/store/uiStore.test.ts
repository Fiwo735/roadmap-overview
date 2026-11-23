import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from './uiStore'

const ui = () => useUiStore.getState()

beforeEach(() => {
  useUiStore.setState({ expandedPlaceId: null, renamingPlaceId: null })
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
