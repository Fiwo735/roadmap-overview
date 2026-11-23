import { useSyncExternalStore } from 'react'

/** Does the window match this media query (`(min-width: 768px)`)? Re-renders when it starts or stops. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
