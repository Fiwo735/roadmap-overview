import { create } from 'zustand'

const STORAGE_KEY = 'roadmap-overview:stats-collapsed'

/** The remembered choice, else collapsed on phones (where the map needs the room) and open elsewhere. */
function initialCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === '1') return true
    if (saved === '0') return false
  } catch {
    // Storage can be blocked; fall through to the default.
  }
  return typeof matchMedia === 'function' && matchMedia('(max-width: 767px)').matches
}

interface StatsCardState {
  /** The title card is folded into a compact pill. Remembered in localStorage. */
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
}

export const useStatsCardStore = create<StatsCardState>()((set) => ({
  collapsed: initialCollapsed(),
  setCollapsed: (collapsed) => {
    set({ collapsed })
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
    } catch {
      // Not remembered, still collapsed for this session.
    }
  },
}))
