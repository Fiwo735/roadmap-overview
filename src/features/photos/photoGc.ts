import { GC_TTL_MS, photoIdsInRawFile, photoIdsOfTrip, planGarbage } from '../../lib/photos'
import { getPhotoStore, type PhotoStore } from '../../services/photoDb'
import { CURRENT_TRIP_KEY, getStorage } from '../../store/persistence'
import { RECENT_TRIPS_KEY } from '../../store/recentTrips'
import { useTripStore } from '../../store/tripStore'

/**
 * Every photo id that something may still want: the open trip and every state in its undo/redo history
 * (so an Undo during this page session finds its photos), the trip in the autosave slot (it may be another
 * tab's) and every recent trip. Returns null when the stored trips cannot be read: then nothing is deleted.
 */
export function protectedPhotoIds(): Set<string> | null {
  const keep = photoIdsOfTrip(useTripStore.getState().trip)
  const history = useTripStore.temporal.getState()
  for (const state of [...history.pastStates, ...history.futureStates]) {
    for (const id of photoIdsOfTrip(state.trip ?? { places: [] })) keep.add(id)
  }

  const storage = getStorage()
  try {
    const current = storage?.getItem(CURRENT_TRIP_KEY)
    if (current) for (const id of photoIdsInRawFile(JSON.parse(current))) keep.add(id)
    const recent = storage?.getItem(RECENT_TRIPS_KEY)
    if (recent) {
      const list: unknown = JSON.parse(recent)
      if (Array.isArray(list)) {
        for (const entry of list) {
          const file = typeof entry === 'object' && entry !== null ? (entry as { file?: unknown }).file : undefined
          for (const id of photoIdsInRawFile(file)) keep.add(id)
        }
      }
    }
  } catch {
    return null
  }
  return keep
}

/**
 * Sweep the photo storage, conservatively (see `planGarbage`): a stored photo that no trip refers to (see
 * `protectedPhotoIds`) is only *marked* with the time it was first found so; it is deleted once it has stayed
 * unreferenced for `ttlMs` (7 days), and a photo that is referenced again loses its mark. Other tabs' undo history
 * and unsaved trips cannot be seen from here, so the delay is what protects them: any tab that still needs a photo
 * clears the mark on its own sweep (they also run every half hour). Best effort: a failure leaves everything for the
 * next time. Returns how many photos were deleted.
 */
export async function collectPhotoGarbage({
  store = getPhotoStore(),
  now = Date.now(),
  ttlMs = GC_TTL_MS,
}: { store?: PhotoStore; now?: number; ttlMs?: number } = {}): Promise<number> {
  try {
    const stored = await store.list()
    if (stored.length === 0) return 0
    // Asked after the (slow) listing, so references that appeared meanwhile count too.
    const keep = protectedPhotoIds()
    if (!keep) return 0
    const plan = planGarbage(stored, keep, now, ttlMs)
    await store.clearUnreferenced(plan.clear)
    await store.markUnreferenced(plan.mark, now)
    await store.delete(plan.delete)
    return plan.delete.length
  } catch {
    return 0
  }
}

let timer: ReturnType<typeof setTimeout> | undefined

/** How often an open page sweeps again: it keeps the marks of the photos this tab still needs (its undo history) cleared. */
export const GC_INTERVAL_MS = 30 * 60 * 1000

/** Collect garbage soon, once however many times this is called: at start-up and after a trip was replaced. */
export function schedulePhotoGc(delayMs = 8_000): void {
  if (timer !== undefined) return
  timer = setTimeout(() => {
    timer = undefined
    void collectPhotoGarbage()
  }, delayMs)
}

/** Dev-only: `window.__ROADMAP__.photos` (tests run the collection themselves instead of waiting for the timer). */
export const photosDebug = {
  collectGarbage: collectPhotoGarbage,
  protectedIds: protectedPhotoIds,
}

declare module '../../types/debug' {
  interface RoadmapDebug {
    /** Photo storage helpers (see `photosDebug` in features/photos/photoGc.ts). */
    photos?: typeof photosDebug
  }
}
