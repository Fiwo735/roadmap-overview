import { create } from 'zustand'

export type Theme = 'light' | 'dark'

/** Non-undoable, non-persisted UI state. Features may add small stores of their own. */
export interface UiState {
  /** The theme currently applied to <html data-theme>. See features/theme. */
  theme: Theme
  /** Mobile slide-over sidebar (ignored on wide screens, where the sidebar is always shown). */
  sidebarOpen: boolean

  selectedPlaceId: string | null
  hoveredPlaceId: string | null
  selectedLegId: string | null
  hoveredLegId: string | null
  /** The place row currently expanded into its search box. */
  expandedPlaceId: string | null
  /** Id of the open modal dialog (e.g. 'share'), or null. */
  openDialogId: string | null

  setTheme: (theme: Theme) => void
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  selectPlace: (id: string | null) => void
  hoverPlace: (id: string | null) => void
  selectLeg: (id: string | null) => void
  hoverLeg: (id: string | null) => void
  expandPlace: (id: string | null) => void
  openDialog: (id: string) => void
  closeDialog: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  theme: 'light',
  sidebarOpen: false,
  selectedPlaceId: null,
  hoveredPlaceId: null,
  selectedLegId: null,
  hoveredLegId: null,
  expandedPlaceId: null,
  openDialogId: null,

  setTheme: (theme) => set({ theme }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  selectPlace: (selectedPlaceId) => set({ selectedPlaceId }),
  hoverPlace: (hoveredPlaceId) => set({ hoveredPlaceId }),
  selectLeg: (selectedLegId) => set({ selectedLegId }),
  hoverLeg: (hoveredLegId) => set({ hoveredLegId }),
  expandPlace: (expandedPlaceId) => set({ expandedPlaceId }),
  openDialog: (openDialogId) => set({ openDialogId }),
  closeDialog: () => set({ openDialogId: null }),
}))
