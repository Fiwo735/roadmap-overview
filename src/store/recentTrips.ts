import { create } from 'zustand'
import { newId } from '../lib/id'
import { addRecent, parseRecentList, withoutRoutes, type RecentEntry } from '../lib/recentTrips'
import { collectLegRoutes, serializeTripFile } from '../lib/tripFile'
import type { Trip } from '../types/trip'
import { getStorage } from './persistence'
import { useRouteStore } from './routeStore'

/**
 * The trips that something replaced (opening a file or link, the sample, "New trip", restoring another
 * one), newest first: `localStorage["roadmap-overview:v1:recent"]` holds a JSON list of
 * `{ id, savedAt, file }`. It is what keeps a user's own trip from being lost to the next link.
 */
export const RECENT_TRIPS_KEY = 'roadmap-overview:v1:recent'

/** What the UI shows of an entry (the trips themselves are only read when one is restored). */
export interface RecentSummary {
  id: string
  savedAt: number
  title: string
  placeCount: number
}

interface RecentState {
  entries: RecentSummary[]
  /** When `entries` was read (ms since epoch): the moment "saved 5 min ago" counts from. */
  loadedAt: number
  /** Re-read the stored list (it may have changed in another tab). */
  refresh: () => void
}

const summarize = ({ id, savedAt, file }: RecentEntry): RecentSummary => ({
  id,
  savedAt,
  title: file.trip.title,
  placeCount: file.trip.places.length,
})

export const useRecentStore = create<RecentState>()((set) => ({
  entries: [],
  loadedAt: Date.now(),
  refresh: () => set({ entries: readRecentTrips().map(summarize), loadedAt: Date.now() }),
}))

/** The stored entries, newest first. Entries that do not hold a valid trip file are left out. */
export function readRecentTrips(): RecentEntry[] {
  try {
    const raw = getStorage()?.getItem(RECENT_TRIPS_KEY)
    return raw ? parseRecentList(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

/** One entry by id, or the newest when no id is given. */
export function findRecentTrip(id?: string): RecentEntry | null {
  const entries = readRecentTrips()
  return (id === undefined ? entries[0] : entries.find((e) => e.id === id)) ?? null
}

/**
 * Write the list, giving up as little as possible when the browser's quota refuses it: first as is,
 * then without any cached routes, then with the oldest entries dropped one by one. Returns what was
 * written, or null when not even the newest entry fits (the stored list is then left as it was).
 */
function writeRecent(storage: Storage, entries: RecentEntry[]): RecentEntry[] | null {
  const lean = entries.map(withoutRoutes)
  const attempts = [entries, lean]
  for (let keep = entries.length - 1; keep >= 1; keep--) attempts.push(lean.slice(0, keep))
  for (const attempt of attempts) {
    try {
      storage.setItem(RECENT_TRIPS_KEY, JSON.stringify(attempt))
      return attempt
    } catch {
      // Too big for the quota (or storage is blocked): try a smaller one.
    }
  }
  return null
}

/**
 * Put `trip` (with the routes it has now) at the front of the recent trips. False when it could not be
 * stored: the caller must then not replace the trip without asking.
 */
export function pushRecentTrip(trip: Trip, now = Date.now()): boolean {
  const storage = getStorage()
  if (!storage) return false
  const file = serializeTripFile(trip, collectLegRoutes(trip, useRouteStore.getState().routes))
  const written = writeRecent(storage, addRecent(readRecentTrips(), { id: newId('r'), savedAt: now, file }))
  if (!written) return false
  useRecentStore.setState({ entries: written.map(summarize), loadedAt: Date.now() })
  return true
}

/** Forget one entry. */
export function removeRecentTrip(id: string): void {
  const storage = getStorage()
  if (!storage) return
  const rest = readRecentTrips().filter((e) => e.id !== id)
  try {
    if (rest.length > 0) storage.setItem(RECENT_TRIPS_KEY, JSON.stringify(rest))
    else storage.removeItem(RECENT_TRIPS_KEY)
  } catch {
    // Removing makes the list smaller; if even that is refused there is nothing more to do.
  }
  useRecentStore.getState().refresh()
}
