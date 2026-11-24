import { toast, type ToastOptions } from '../../components/toast'
import { photoIdsOfTrip } from '../../lib/photos'
import { tripFingerprint } from '../../lib/recentTrips'
import { parseTripJson } from '../../lib/tripFileIo'
import { fetchTripText, TripSourceError } from '../../services/tripSource'
import { SAMPLE_TRIP_URL } from '../../services/config'
import { findRecentTrip, pushRecentTrip, removeRecentTrip } from '../../store/recentTrips'
import { useRouteStore } from '../../store/routeStore'
import { clearHistory, undo, useTripStore } from '../../store/tripStore'
import { withPreferredVehicle } from '../../store/vehiclePreference'
import type { Trip, TripFile } from '../../types/trip'
import { getMap } from '../map/mapInstance'
import { discardPhotos, storePhotosOf } from '../photos/photoFile'
import { editingLockedReason } from '../ride/rideStore'
import { fitMapToTrip } from '../routing/mapFit'
import { askToConfirm } from './confirm'

const placesText = (n: number): string => `${n} place${n === 1 ? '' : 's'}`
/** “Title” for a message; a trip without a title shows as the placeholder the title field uses. */
const quoted = (title: string): string => `“${title || 'Untitled trip'}”`

/** Waits (briefly) for the map, which may not have mounted yet when an import runs at start-up. */
function whenMapReady(fn: () => void, framesLeft = 120): void {
  if (getMap()) fn()
  else if (framesLeft > 0) requestAnimationFrame(() => whenMapReady(fn, framesLeft - 1))
}

/**
 * Swap the whole trip for `file`'s as ONE undoable step. Its cached routes go into the route store
 * first, so the route manager finds them (by key) instead of asking OSRM again. Does not look after
 * the trip it replaces: see `keepOpenTrip`.
 */
export function installTrip(file: TripFile): void {
  useRouteStore.getState().setRoutes(Object.values(file.routes ?? {}))
  useTripStore.getState().replaceTrip(file.trip)
  whenMapReady(() => fitMapToTrip())
}

/** "Some data was repaired" note for a toast: the first two repairs, then a count. */
function repairNote(warnings: string[]): string {
  if (warnings.length === 0) return ''
  const more = warnings.length > 2 ? ` (and ${warnings.length - 2} more)` : ''
  return ` The file had problems that were repaired: ${warnings.slice(0, 2).join(' ')}${more}`
}

// A toast can outlive the moment it was shown: its actions change the trip, so they ask the editing lock again when clicked.
const undoAction: ToastOptions['action'] = { label: 'Undo', onClick: undo, blockedBy: editingLockedReason }

// ---------------------------------------------------------------------------------------------
// Looking after the trip that is about to be replaced

export type Kept = 'nothing' | 'kept' | 'failed'

/**
 * Call before anything replaces the open trip (`incoming`: what comes instead, if it is a trip):
 * a trip with places goes to the front of the recent trips ("kept"). There is nothing to keep for an
 * empty trip or when the same trip comes back ("nothing"). "failed" means it could not be stored
 * (quota, blocked storage): the caller must then ask before replacing.
 */
export function keepOpenTrip(incoming?: Trip): Kept {
  const open = useTripStore.getState().trip
  if (open.places.length === 0) return 'nothing'
  if (incoming && tripFingerprint(incoming) === tripFingerprint(open)) return 'nothing'
  return pushRecentTrip(open) ? 'kept' : 'failed'
}

/** Replace the trip the user has open with `file` — after keeping the old one, or after they confirmed losing it. */
export async function replaceOpenTrip(file: TripFile, what: string): Promise<boolean> {
  if (keepOpenTrip(file.trip) === 'failed') {
    const open = quoted(useTripStore.getState().trip.title)
    const confirmed = await askToConfirm({
      title: 'Replace the open trip?',
      description: `This browser has no room to keep a copy of ${open}, so opening ${what} replaces it for good. Save it as a JSON file first if you want to keep it.`,
      confirmLabel: 'Replace trip',
    })
    if (!confirmed) return false
  }
  installTrip(file)
  return true
}

// ---------------------------------------------------------------------------------------------
// Opening what the user chose

/**
 * Open the text of a trip file (a picked or dropped file, the sample) in place of the open trip. A file keeps
 * its own vehicle; `withPreferredVehicle` (the sample) gives one that has none the vehicle chosen last.
 */
export async function openTripText(text: string, name: string, { withPreferredVehicle: usePreference = false } = {}): Promise<boolean> {
  const parsed = parseTripJson(text)
  if (!parsed.ok) {
    toast.error(`Could not open ${name}. ${parsed.error}`)
    return false
  }
  if (usePreference) parsed.file.trip = withPreferredVehicle(parsed.file.trip)
  // The photos a file carries go into the browser's storage before the trip that refers to them is opened (F11);
  // when the trip is not opened after all, the ones that were just stored go again.
  const { file, notes, added } = await storePhotosOf(parsed.file)
  const warnings = [...parsed.warnings, ...notes]
  const locked = editingLockedReason()
  if (locked) {
    // Reading a big file takes a while: presentation mode or a ride may have begun meanwhile.
    void discardPhotos(added)
    toast.info(`${name} was not opened. ${locked}`)
    return false
  }
  if (!(await replaceOpenTrip(file, name))) {
    void discardPhotos(added)
    return false
  }
  const { title, places } = file.trip
  toast.success(`Opened ${quoted(title)} (${placesText(places.length)}).${repairNote(warnings)}`, {
    action: undoAction,
    duration: warnings.length > 0 ? 9_000 : undefined,
  })
  return true
}

/**
 * The biggest trip file the user can pick or drop. A file saved with photos (F11) holds a few hundred of them at around
 * 0.5 MB each, so this is far above the 20 MB that a trip file fetched from a web address may be (`?src=`, unchanged),
 * yet small enough for a phone to read into memory.
 */
export const MAX_PICKED_TRIP_FILE_BYTES = 150 * 1024 * 1024

/** Open a file the user picked or dropped. */
export async function openTripFileFromDisk(file: File): Promise<void> {
  if (file.size > MAX_PICKED_TRIP_FILE_BYTES) {
    toast.error(`Could not open ${file.name}. The file is too large to be a trip.`)
    return
  }
  let text: string
  try {
    text = await file.text()
  } catch {
    toast.error(`Could not read ${file.name}.`)
    return
  }
  await openTripText(text, file.name)
}

/** Open the bundled sample trip. */
export async function loadSampleTrip(): Promise<void> {
  let text: string
  try {
    text = await fetchTripText(SAMPLE_TRIP_URL)
  } catch (err) {
    toast.error(`Could not load the sample trip. ${err instanceof TripSourceError ? err.message : ''}`.trim())
    return
  }
  await openTripText(text, 'the sample trip', { withPreferredVehicle: true })
}

/** Bring a recent trip back (the newest when no id is given). The open trip takes its place in the list. */
export async function restoreRecentTrip(id?: string): Promise<void> {
  const entry = findRecentTrip(id)
  if (!entry) {
    toast.error('There is no previous trip to restore.')
    return
  }
  const { title, places } = entry.file.trip
  if (!(await replaceOpenTrip(entry.file, quoted(title)))) return
  removeRecentTrip(entry.id)
  toast.success(`Restored ${quoted(title)} (${placesText(places.length)}).`, { action: undoAction })
}

// ---------------------------------------------------------------------------------------------
// Trips arriving from outside (a share link, `?src=`): nobody clicked "open" on a file

function announceLinkedTrip(file: TripFile, warnings: string[], kept: boolean): void {
  const { title, places } = file.trip
  const opened = `Opened ${quoted(title)} (${placesText(places.length)}).${repairNote(warnings)}`
  if (kept) {
    toast.info(`${opened} Your previous trip was kept.`, {
      action: { label: 'Restore previous trip', onClick: () => void restoreRecentTrip(), blockedBy: editingLockedReason },
      duration: 20_000,
    })
  } else {
    toast.success(opened, { duration: warnings.length > 0 ? 9_000 : undefined })
  }
}

/**
 * Open a trip that came from a link. The trip the user has open is first put in the recent trips (the
 * toast offers to restore it). When that is impossible it is not replaced silently: a toast asks, and
 * only its action opens the linked trip. `atStart` (nothing to undo yet) clears the history so Ctrl+Z
 * cannot walk back into the page's previous state.
 */
export function openLinkedTrip(file: TripFile, warnings: string[], { atStart = false } = {}): void {
  const kept = keepOpenTrip(file.trip)
  // A linked file may carry photos (`?src=`): they are stored only when the trip is really opened, so a toast
  // that is never answered leaves nothing behind. (Links themselves carry none, and are opened without waiting.)
  const withPhotos = photoIdsOfTrip(file.trip).size > 0
  if (kept === 'failed') {
    toast.info(
      `A linked trip, ${quoted(file.trip.title)}, is ready, but this browser has no room to keep a copy of your open trip. Opening it replaces that trip for good.`,
      {
        action: {
          label: 'Open linked trip anyway',
          onClick: () => {
            if (withPhotos) void installLinkedWithPhotos(file, warnings, false)
            else {
              installTrip(file)
              announceLinkedTrip(file, warnings, false)
            }
          },
          blockedBy: editingLockedReason,
        },
        duration: 30_000,
      },
    )
    return
  }
  if (withPhotos) {
    void installLinkedWithPhotos(file, warnings, kept === 'kept')
    return
  }
  installTrip(file)
  if (atStart) clearHistory()
  announceLinkedTrip(file, warnings, kept === 'kept')
}

/** `openLinkedTrip`'s last step for a file with photos: they are stored first, then the trip is installed. */
async function installLinkedWithPhotos(file: TripFile, warnings: string[], kept: boolean): Promise<void> {
  const prepared = await storePhotosOf(file)
  installTrip(prepared.file)
  announceLinkedTrip(prepared.file, [...warnings, ...prepared.notes], kept)
}

/** A linked trip that arrived after the user had started editing: ask before replacing their work. */
export function offerLinkedTrip(file: TripFile, warnings: string[], host: string): void {
  toast.info(`Open the linked trip ${quoted(file.trip.title)} from ${host}? It replaces the trip you are editing, which stays in Recent trips.`, {
    action: { label: 'Open linked trip', onClick: () => openLinkedTrip(file, warnings), blockedBy: editingLockedReason },
    duration: 30_000,
  })
}
