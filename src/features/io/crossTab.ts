import { toast, useToastStore } from '../../components/toast'
import { tripFingerprint } from '../../lib/recentTrips'
import { parseTripFile } from '../../lib/tripFile'
import { CURRENT_TRIP_KEY, getStorage, holdAutosave, releaseAutosave } from '../../store/persistence'
import { undo, useTripStore } from '../../store/tripStore'
import type { TripFile } from '../../types/trip'
import { usePresentationStore } from '../presentation/presentationStore'
import { editingLockedReason, isEditingLocked, useRideStore } from '../ride/rideStore'
import { keepOpenTrip, replaceOpenTrip } from './importTrip'

/** The autosaved trip as it is stored now, or null when there is none or it cannot be read. */
function readStoredTrip(): TripFile | null {
  try {
    const raw = getStorage()?.getItem(CURRENT_TRIP_KEY)
    const parsed = raw ? parseTripFile(JSON.parse(raw)) : null
    return parsed?.ok ? parsed.file : null
  } catch {
    return null
  }
}

/**
 * Two tabs share one autosave slot, so the last one to save wins. When ANOTHER tab saves a different trip
 * than the one open here (the `storage` event only reaches the other tabs), this tab asks instead of
 * silently overwriting it with its next save: a toast "This trip was changed in another tab" with
 * **Load it** (replace the trip here with the stored one, undoable, this tab's trip goes to the recent
 * trips) and **Keep mine** (save this tab's trip again). Until the user chooses, this tab's autosave is
 * held, so nothing is lost either way; the toast has no dismiss button for the same reason. While the
 * choice is open this tab's own trip exists only in memory, so when the page goes away it is put in the
 * recent trips (`keepOpenTrip`): the user can still get it back from File → Recent trips.
 *
 * While editing is locked (a ride, presentation mode: `isEditingLocked`) the question is not asked: the
 * trip must not be replaced under a show. The hold starts at once, though, and the question comes when the
 * lock ends (and goes away again if a lock begins while it is showing).
 *
 * Returns a function that stops listening.
 */
export function startCrossTabSync(): () => void {
  /** The toast that asks, while it is up. */
  let pending: number | null = null
  /** A different trip was saved while editing was locked: ask when it ends. */
  let deferred = false
  let asking = false

  const showing = () => pending !== null && useToastStore.getState().toasts.some((t) => t.id === pending)

  const dismissQuestion = (): void => {
    const id = pending
    pending = null
    if (id !== null) toast.dismiss(id)
  }

  /** Nothing is waiting for an answer any more: saving may go on. */
  const settled = (save: boolean): void => {
    dismissQuestion()
    deferred = false
    releaseAutosave(save)
  }

  const load = () => {
    pending = null
    const file = readStoredTrip()
    if (!file) {
      // Nothing usable there any more: this tab's trip is the only one.
      settled(true)
      toast.error('The other tab’s trip could not be read, so this tab’s trip was kept.')
      return
    }
    // Nothing is lost: this tab's trip goes to the recent trips and the load can be undone. When it
    // cannot be kept, the user is asked before it is replaced for good (the same rule as for any file).
    void replaceOpenTrip(file, 'the other tab’s trip').then((replaced) => {
      if (!replaced) {
        ask()
        return
      }
      settled(true)
      toast.success('Loaded the trip from the other tab.', { action: { label: 'Undo', onClick: undo, blockedBy: editingLockedReason } })
    })
  }

  const keep = () => {
    pending = null
    settled(true)
  }

  const ask = () => {
    holdAutosave()
    if (isEditingLocked()) {
      deferred = true
      return
    }
    asking = true
    pending = toast.info('This trip was changed in another tab.', {
      duration: 0,
      dismissible: false,
      action: { label: 'Load it', onClick: load, blockedBy: editingLockedReason },
      secondaryAction: { label: 'Keep mine', onClick: keep },
    })
    asking = false
  }

  /** `stored`: the trip another tab saved (or null when it cannot be read). Decide whether the user has to choose. */
  const consider = (stored: TripFile | null): void => {
    if (!stored) {
      if (deferred || pending !== null) settled(true)
      return
    }
    if (tripFingerprint(stored.trip) === tripFingerprint(useTripStore.getState().trip)) {
      // Both tabs show the same trip (the other one loaded ours, or both made the same edit): nothing to decide.
      if (deferred || pending !== null) settled(false)
      return
    }
    // The toast reads the stored trip when it is answered, so further saves from the other tab need no new toast.
    if (!showing() && !deferred) ask()
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key !== CURRENT_TRIP_KEY || e.newValue === null || e.storageArea !== getStorage()) return
    let file: TripFile | null = null
    try {
      const parsed = parseTripFile(JSON.parse(e.newValue))
      file = parsed.ok ? parsed.file : null
    } catch {
      file = null
    }
    // Unreadable data (another program, an old version) is not a question: only a real trip is.
    if (file) consider(file)
  }

  // The lock begins: a question that is up goes away (its hold stays) and returns when the lock ends.
  const onLockChange = (): void => {
    if (isEditingLocked()) {
      if (pending !== null) {
        dismissQuestion()
        deferred = true
      }
    } else if (deferred) {
      deferred = false
      consider(readStoredTrip())
    }
  }

  // While the question stands this tab's trip is only in memory: do not let the page take it along.
  const keepOnLeave = (): void => {
    if (pending === null && !deferred) return
    keepOpenTrip(readStoredTrip()?.trip)
  }
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') keepOnLeave()
  }

  // The toast can be pushed out of the queue by newer ones: the question must not vanish while the autosave is held.
  const unsubscribeToasts = useToastStore.subscribe(() => {
    if (!asking && pending !== null && !showing()) ask()
  })
  const unsubscribeRide = useRideStore.subscribe((s, prev) => {
    if (s.active !== prev.active) onLockChange()
  })
  const unsubscribePresentation = usePresentationStore.subscribe((s, prev) => {
    if (s.on !== prev.on) onLockChange()
  })

  window.addEventListener('storage', onStorage)
  window.addEventListener('pagehide', keepOnLeave)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    unsubscribeToasts()
    unsubscribeRide()
    unsubscribePresentation()
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('pagehide', keepOnLeave)
    document.removeEventListener('visibilitychange', onVisibility)
    settled(false)
  }
}
