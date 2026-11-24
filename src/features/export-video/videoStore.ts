import { create } from 'zustand'
import { DEFAULT_VIDEO_OPTIONS, sanitizeVideoOptions, type VideoOptions } from './options'

const STORAGE_KEY = 'roadmap-overview:video-options'

function load(): VideoOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? sanitizeVideoOptions(JSON.parse(raw)) : { ...DEFAULT_VIDEO_OPTIONS }
  } catch {
    return { ...DEFAULT_VIDEO_OPTIONS }
  }
}

interface VideoOptionsState {
  options: VideoOptions
  setOptions: (patch: Partial<VideoOptions>) => void
}

/** What the Video tab was last set to: a per-viewer convenience, kept in localStorage when it is available. */
export const useVideoOptions = create<VideoOptionsState>()((set, get) => ({
  options: load(),
  setOptions: (patch) => {
    const options = sanitizeVideoOptions({ ...get().options, ...patch })
    set({ options })
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(options))
    } catch {
      // Private windows and full storage: the choice then only lasts until the page is closed.
    }
  },
}))
