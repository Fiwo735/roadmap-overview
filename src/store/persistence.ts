import { toast } from '../components/toast'
import { collectLegRoutes, parseTripFile, serializeTripFile } from '../lib/tripFile'
import { clearHistory, useTripStore } from './tripStore'
import { useRouteStore } from './routeStore'

// Every storage id (these, and the other `roadmap-overview:…` keys) keeps the app's first name: renaming one would orphan what
// people already saved. Vanagram is only the name people see.
export const CURRENT_TRIP_KEY = 'roadmap-overview:v1:current'
/** Where unreadable saved data is copied before autosave overwrites it. */
export const CORRUPT_TRIP_KEY = 'roadmap-overview:v1:corrupt'

/** localStorage can be missing or throw (private mode, blocked site data); never let that escape. */
export function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export type RestoreResult = 'restored' | 'none' | 'corrupt'

/** Load the autosaved trip (and its cached routes) into the stores. Starts with empty history. */
export function restoreSavedTrip(): RestoreResult {
  const storage = getStorage()
  let raw: string | null
  try {
    raw = storage?.getItem(CURRENT_TRIP_KEY) ?? null
  } catch {
    return 'none'
  }
  if (raw === null) return 'none'

  let parsed
  try {
    parsed = parseTripFile(JSON.parse(raw))
  } catch {
    parsed = null
  }
  if (!parsed || !parsed.ok) {
    try {
      storage?.setItem(CORRUPT_TRIP_KEY, raw)
    } catch {
      // Nothing more to do: the backup is best effort.
    }
    return 'corrupt'
  }

  useTripStore.getState().replaceTrip(parsed.file.trip)
  useRouteStore.getState().setRoutes(Object.values(parsed.file.routes ?? {}))
  clearHistory()
  return 'restored'
}

// While another tab's version of the trip waits for the user's decision (features/io/crossTab.ts) our own
// saves must not overwrite it: they are held, and the decision releases them.
let held = false
let saveNow: (() => void) | null = null

/** Stop writing the autosave until `releaseAutosave`: another tab saved a trip and the user has yet to choose. */
export function holdAutosave(): void {
  held = true
}

/** Autosave may write again; with `save` it writes the open trip at once (it wins over what is stored). */
export function releaseAutosave(save: boolean): void {
  held = false
  if (save) saveNow?.()
}

/** After a failed save, wait at least this long before trying (and serialising) again. */
const FAILURE_BACKOFF_MS = 30_000

/**
 * Debounced autosave of the current trip and its cached routes. Returns a function that stops it.
 * A save happens at most every `delayMs` while edits keep coming, and immediately when the page
 * is hidden or unloaded.
 *
 * When the browser refuses a write (typically a full quota) the save is retried once without the
 * cached routes, which are cheap to derive again. If even that fails the user is told once, and
 * further attempts back off so a broken storage does not cost a JSON.stringify per keystroke.
 */
export function startAutosave(delayMs = 500): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let warned = false
  let skipRoutes = false
  let retryAt = 0

  const write = (storage: Storage, includeRoutes: boolean): boolean => {
    try {
      const { trip } = useTripStore.getState()
      const routes = includeRoutes ? collectLegRoutes(trip, useRouteStore.getState().routes) : {}
      storage.setItem(CURRENT_TRIP_KEY, JSON.stringify(serializeTripFile(trip, routes)))
      return true
    } catch {
      return false
    }
  }

  const save = () => {
    timer = undefined
    const storage = getStorage()
    if (!storage || held) return
    if (Date.now() < retryAt) {
      timer = setTimeout(save, retryAt - Date.now())
      return
    }
    if (!skipRoutes && write(storage, true)) {
      warned = false
      return
    }
    // Remember the fallback so a persistently full storage does not cost two attempts per save.
    skipRoutes = true
    if (write(storage, false)) {
      warned = false
      return
    }
    retryAt = Date.now() + FAILURE_BACKOFF_MS
    if (!warned) {
      warned = true
      toast.error('Could not save your trip in this browser. Export it to a file to keep it.')
    }
  }

  const schedule = () => {
    timer ??= setTimeout(save, delayMs)
  }
  const flush = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    // Unloading: a backoff must not swallow the last chance to save.
    retryAt = 0
    save()
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  saveNow = () => {
    if (timer !== undefined) clearTimeout(timer)
    retryAt = 0
    save()
  }

  const unsubTrip = useTripStore.subscribe((s, prev) => {
    if (s.trip !== prev.trip) schedule()
  })
  const unsubRoutes = useRouteStore.subscribe((s, prev) => {
    if (s.routes !== prev.routes) schedule()
  })
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    saveNow = null
    held = false
    unsubTrip()
    unsubRoutes()
    window.removeEventListener('pagehide', flush)
    document.removeEventListener('visibilitychange', onVisibility)
    if (timer !== undefined) clearTimeout(timer)
  }
}
