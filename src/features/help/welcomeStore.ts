import { create } from 'zustand'

/** Set to "1" once the first-visit hint was dismissed, or a trip had places (the hint is for newcomers). */
export const WELCOME_SEEN_KEY = 'roadmap-overview:welcome-seen'

function read(): boolean {
  try {
    return localStorage.getItem(WELCOME_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export const useWelcomeStore = create<{ seen: boolean }>()(() => ({ seen: read() }))

/** Never show the hint again (this browser). */
export function dismissWelcome(): void {
  useWelcomeStore.setState({ seen: true })
  try {
    localStorage.setItem(WELCOME_SEEN_KEY, '1')
  } catch {
    // Without storage the hint only stays away for this session.
  }
}
