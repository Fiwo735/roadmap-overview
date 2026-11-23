import type { Trip, TripFile } from '../types/trip'
import { parseTripFile } from './tripFile'

/** How many replaced trips are kept for "Recent trips". */
export const MAX_RECENT_TRIPS = 5

/** A trip that was open before something replaced it, with the routes it had. */
export interface RecentEntry {
  id: string
  /** When it was put away (ms since epoch). */
  savedAt: number
  file: TripFile
}

/** JSON with object keys sorted, so equal content gives equal text whatever order the keys were built in. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const fields = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** cyrb53: a small, well-spread 53-bit string hash (not cryptographic; it only tells trips apart). */
function hash53(text: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** Identifies a trip by its content (id, title, places, legs …); equal trips have equal fingerprints. */
export function tripFingerprint(trip: Trip): string {
  const text = stableStringify(trip)
  return `${hash53(text).toString(36)}-${text.length.toString(36)}`
}

/** `entries` (newest first) with `entry` in front: an older entry of the same content is replaced, the list is capped. */
export function addRecent(entries: readonly RecentEntry[], entry: RecentEntry, max = MAX_RECENT_TRIPS): RecentEntry[] {
  const print = tripFingerprint(entry.file.trip)
  return [entry, ...entries.filter((e) => tripFingerprint(e.file.trip) !== print)].slice(0, max)
}

/** The same entry without its cached routes (they can be derived again, and are most of its size). */
export const withoutRoutes = (entry: RecentEntry): RecentEntry => ({ ...entry, file: { ...entry.file, routes: {} } })

/**
 * Entries from untrusted stored data: anything that is not a well-formed entry holding a valid trip file
 * is skipped (the rest still loads), and at most `max` are returned.
 */
export function parseRecentList(raw: unknown, max = MAX_RECENT_TRIPS): RecentEntry[] {
  if (!Array.isArray(raw)) return []
  const entries: RecentEntry[] = []
  for (const item of raw) {
    if (entries.length >= max) break
    if (typeof item !== 'object' || item === null) continue
    const { id, savedAt, file } = item as Record<string, unknown>
    if (typeof id !== 'string' || !id || typeof savedAt !== 'number' || !Number.isFinite(savedAt)) continue
    const parsed = parseTripFile(file)
    if (parsed.ok) entries.push({ id, savedAt, file: parsed.file })
  }
  return entries
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "just now", "5 min ago", "3 h ago", "2 days ago", or the date for anything older than a week. */
export function describeAge(savedAt: number, now: number): string {
  const age = Math.max(0, now - savedAt)
  if (age < MINUTE) return 'just now'
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`
  if (age < DAY) return `${Math.floor(age / HOUR)} h ago`
  if (age < 7 * DAY) {
    const days = Math.floor(age / DAY)
    return `${days} day${days === 1 ? '' : 's'} ago`
  }
  return new Date(savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
