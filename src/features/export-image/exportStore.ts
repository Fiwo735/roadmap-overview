import { create } from 'zustand'
import { DEFAULT_EXPORT_OPTIONS, sanitizeOptions, type ExportOptions } from './options'

const STORAGE_KEY = 'roadmap-overview:export-options'

function load(): ExportOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? sanitizeOptions(JSON.parse(raw)) : { ...DEFAULT_EXPORT_OPTIONS }
  } catch {
    return { ...DEFAULT_EXPORT_OPTIONS }
  }
}

interface ExportOptionsState {
  options: ExportOptions
  setOptions: (patch: Partial<ExportOptions>) => void
}

/** What the export dialog was last set to: a per-viewer convenience, kept in localStorage when it is available. */
export const useExportOptions = create<ExportOptionsState>()((set, get) => ({
  options: load(),
  setOptions: (patch) => {
    const options = sanitizeOptions({ ...get().options, ...patch })
    set({ options })
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(options))
    } catch {
      // Private windows and full storage: the choice then only lasts until the page is closed.
    }
  },
}))
