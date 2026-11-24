import type { PlacePhoto, Trip, TripFile } from '../types/trip'

/**
 * Photos of places (F11): the framework-free rules. The trip only holds references (`Place.photos`);
 * the bytes live in IndexedDB (`services/photoDb.ts`) and inside saved JSON files (`TripFile.photos`).
 */

/** Photos are shrunk to this many pixels on the long edge (never enlarged) and stored as JPEG. */
export const MAX_LONG_EDGE = 2048
export const JPEG_QUALITY = 0.85
/** The small copy shown in lists and on the place card. */
export const THUMB_LONG_EDGE = 320
export const THUMB_QUALITY = 0.8
/** An input file bigger than this is refused before it is decoded. */
export const MAX_INPUT_BYTES = 30 * 1024 * 1024
export const MAX_PHOTOS_PER_PLACE = 50
export const MAX_PHOTOS_PER_TRIP = 300
export const MAX_CAPTION_LENGTH = 200
/** A photo in a file may claim at most this many pixels per side (ours are ≤ 2048; other tools may differ). */
export const MAX_FILE_PHOTO_DIMENSION = 16_384
/** Longest base64 text of one embedded photo (≈ 10.5 MB of JPEG); bigger ones are dropped when a file is opened. */
export const MAX_FILE_PHOTO_BASE64_CHARS = 14_000_000
/**
 * A stored photo that nothing refers to is only deleted after it has stayed unreferenced for this long. Other tabs
 * (their undo history, a trip not saved yet) are invisible to this one, so the delay, not what this tab sees, is
 * the protection: any tab that still needs a photo clears the mark the next time it looks.
 */
export const GC_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** An embedded photo whose decoded size exceeds this many pixels is refused when a file is opened (a 64-megapixel JPEG decodes to 256 MB). */
export const MAX_DECODE_PIXELS = 64_000_000

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** `width` x `height` scaled down (never up) so the longer side is at most `longEdge`; both at least 1 pixel. */
export function fitWithin(width: number, height: number, longEdge: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 }
  const scale = Math.min(1, longEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

// ---------------------------------------------------------------------------------------------
// References in the trip

const isDimension = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_FILE_PHOTO_DIMENSION

/** One photo reference from untrusted data, or null when it cannot be used. */
export function cleanPhoto(raw: unknown): PlacePhoto | null {
  if (!isRecord(raw)) return null
  const { id, width, height, caption } = raw
  if (typeof id !== 'string' || id.length === 0 || id.length > 100) return null
  if (!isDimension(width) || !isDimension(height)) return null
  const photo: PlacePhoto = { id, width, height }
  if (typeof caption === 'string' && caption.trim()) photo.caption = caption.slice(0, MAX_CAPTION_LENGTH)
  return photo
}

/**
 * A list of photo references from untrusted data: unusable entries and repeated ids are left out, and at
 * most `max` are kept. `dropped` counts what was left out (for a warning).
 */
export function cleanPhotoList(raw: unknown, max = MAX_PHOTOS_PER_PLACE): { photos: PlacePhoto[]; dropped: number } {
  if (!Array.isArray(raw)) return { photos: [], dropped: raw === undefined ? 0 : 1 }
  const photos: PlacePhoto[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const photo = cleanPhoto(item)
    if (!photo || seen.has(photo.id) || photos.length >= max) continue
    seen.add(photo.id)
    photos.push(photo)
  }
  return { photos, dropped: raw.length - photos.length }
}

/**
 * The photo ids that a stored, unvalidated trip file refers to (`raw` is whatever JSON was stored). Reads as
 * much as it can and never throws: for deciding what must NOT be deleted, so more is better than less.
 */
export function photoIdsInRawFile(raw: unknown): string[] {
  if (!isRecord(raw) || !isRecord(raw.trip) || !Array.isArray(raw.trip.places)) return []
  const ids: string[] = []
  for (const place of raw.trip.places) {
    if (!isRecord(place) || !Array.isArray(place.photos)) continue
    for (const photo of place.photos) if (isRecord(photo) && typeof photo.id === 'string') ids.push(photo.id)
  }
  return ids
}

/** How many photos the trip refers to, over all its places. */
export function tripPhotoCount(trip: Pick<Trip, 'places'>): number {
  return trip.places.reduce((sum, p) => sum + (p.photos?.length ?? 0), 0)
}

/** The ids of every photo the trip refers to. */
export function photoIdsOfTrip(trip: Pick<Trip, 'places'>): Set<string> {
  const ids = new Set<string>()
  for (const place of trip.places) for (const photo of place.photos ?? []) ids.add(photo.id)
  return ids
}

/** How many more photos `placePhotos` may take: the per-place and the per-trip limit, whichever is tighter. */
export function photoSlotsLeft(placePhotos: number, tripPhotos: number): number {
  return Math.max(0, Math.min(MAX_PHOTOS_PER_PLACE - placePhotos, MAX_PHOTOS_PER_TRIP - tripPhotos))
}

/**
 * `photos` of place `placeId` cut so the whole trip stays within `MAX_PHOTOS_PER_TRIP` (the other places'
 * photos count in full).
 */
export function capForTrip(trip: Pick<Trip, 'places'>, placeId: string, photos: PlacePhoto[]): PlacePhoto[] {
  const others = trip.places.reduce((sum, p) => sum + (p.id === placeId ? 0 : (p.photos?.length ?? 0)), 0)
  const room = Math.max(0, MAX_PHOTOS_PER_TRIP - others)
  return photos.length > room ? photos.slice(0, room) : photos
}

/** The photo at `index` moved `delta` places (−1 earlier, +1 later); the same list when it cannot move. */
export function movePhoto(photos: readonly PlacePhoto[], index: number, delta: number): PlacePhoto[] {
  const to = index + delta
  if (index < 0 || index >= photos.length || to < 0 || to >= photos.length || delta === 0) return photos.slice()
  const next = photos.slice()
  const [moved] = next.splice(index, 1)
  next.splice(to, 0, moved)
  return next
}

/** The trip's file without photos: no embedded bytes and no references (share links carry neither). */
export function withoutPhotos(file: TripFile): TripFile {
  const { photos: _bytes, ...rest } = file
  if (!rest.trip.places.some((p) => p.photos)) return rest
  return { ...rest, trip: { ...rest.trip, places: rest.trip.places.map(({ photos: _refs, ...place }) => place) } }
}

/** `file` with the references to photos that are not in `available` left out (an empty list removes the key). */
export function withoutMissingPhotos(file: TripFile, available: ReadonlySet<string>): { file: TripFile; missing: number } {
  let missing = 0
  const places = file.trip.places.map((place) => {
    if (!place.photos) return place
    const kept = place.photos.filter((p) => available.has(p.id))
    missing += place.photos.length - kept.length
    if (kept.length === place.photos.length) return place
    const { photos: _old, ...rest } = place
    return kept.length > 0 ? { ...rest, photos: kept } : rest
  })
  return missing === 0 ? { file, missing } : { file: { ...file, trip: { ...file.trip, places } }, missing }
}

// ---------------------------------------------------------------------------------------------
// Choosing what to add

export type PhotoProblem = 'not-image' | 'heic' | 'too-large' | 'empty' | 'unreadable' | 'no-room'

const HEIC_TYPES = /^image\/(heic|heif|heic-sequence|heif-sequence)$/i
const HEIC_NAME = /\.(heic|heif|hif)$/i
const IMAGE_NAME = /\.(jpe?g|png|webp|gif|avif|bmp|heic|heif|hif|tiff?)$/i

/** Does this look like an image the user means as a photo (by type, or by name when the type is blank)? SVG is not one. */
export function looksLikeImage(file: { name: string; type: string }): boolean {
  if (file.type) return /^image\//i.test(file.type) && !/svg/i.test(file.type)
  return IMAGE_NAME.test(file.name)
}

export const isHeic = (file: { name: string; type: string }): boolean => HEIC_TYPES.test(file.type) || HEIC_NAME.test(file.name)

export interface BatchPlan {
  /** Indices (into the input list) of the files to process, in order. */
  accepted: number[]
  rejected: { index: number; name: string; problem: PhotoProblem }[]
}

/** Which of `files` to process given `slots` free places: wrong kinds, empty and oversized files and the surplus are rejected. */
export function planBatch(files: readonly { name: string; size: number; type: string }[], slots: number): BatchPlan {
  const accepted: number[] = []
  const rejected: BatchPlan['rejected'] = []
  files.forEach((file, index) => {
    const reject = (problem: PhotoProblem) => rejected.push({ index, name: file.name, problem })
    if (!looksLikeImage(file)) reject('not-image')
    else if (file.size === 0) reject('empty')
    else if (file.size > MAX_INPUT_BYTES) reject('too-large')
    else if (accepted.length >= slots) reject('no-room')
    else accepted.push(index)
  })
  return { accepted, rejected }
}

const PROBLEM_TEXT: Record<PhotoProblem, string> = {
  'not-image': 'is not an image',
  heic: 'is a HEIC photo, which this browser cannot read (convert it to JPEG first)',
  'too-large': `is larger than ${MAX_INPUT_BYTES / 1024 / 1024} MB`,
  empty: 'is empty',
  unreadable: 'could not be read as an image',
  'no-room': `did not fit (a place holds at most ${MAX_PHOTOS_PER_PLACE} photos, a trip ${MAX_PHOTOS_PER_TRIP})`,
}

/** A sentence for a toast about files that were not added: the first one by name, the others counted. */
export function describeProblems(problems: readonly { name: string; problem: PhotoProblem }[]): string {
  if (problems.length === 0) return ''
  const [first] = problems
  if (problems.length === 1) return `${first.name} ${PROBLEM_TEXT[first.problem]}.`
  const more = problems.length - 1
  return `${problems.length} files were not added. ${first.name} ${PROBLEM_TEXT[first.problem]}; ${more} other${more === 1 ? ' had a problem' : 's had problems'} too.`
}

// ---------------------------------------------------------------------------------------------
// Garbage collection

export interface StoredPhotoMeta {
  id: string
  /** When the bytes were stored (ms since epoch). */
  createdAt: number
  /** When garbage collection first found nothing referring to the photo (ms since epoch); absent while it is in use. */
  unreferencedSince?: number
}

export interface GarbagePlan {
  /** Unreferenced for the first time: remember since when. */
  mark: string[]
  /** Referenced again: forget the mark. */
  clear: string[]
  /** Unreferenced for at least `ttlMs`: delete. */
  delete: string[]
}

/**
 * What a garbage collection does, given the stored photos, the ids that something still refers to (`keep`) and the
 * time. Conservative on purpose: a photo is never deleted the first time it is found unreferenced, only when it has
 * stayed so for `ttlMs` (a clock set back never deletes anything).
 */
export function planGarbage(stored: readonly StoredPhotoMeta[], keep: ReadonlySet<string>, now: number, ttlMs = GC_TTL_MS): GarbagePlan {
  const plan: GarbagePlan = { mark: [], clear: [], delete: [] }
  for (const photo of stored) {
    if (keep.has(photo.id)) {
      if (photo.unreferencedSince !== undefined) plan.clear.push(photo.id)
    } else if (photo.unreferencedSince === undefined) {
      plan.mark.push(photo.id)
    } else if (now - photo.unreferencedSince >= ttlMs) {
      plan.delete.push(photo.id)
    }
  }
  return plan
}

// ---------------------------------------------------------------------------------------------
// Embedding in a trip file

const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/

/** Is `data` plausibly the base64 of a JPEG (the first three bytes FF D8 FF are "/9j/")? Does not decode it. */
export function isJpegBase64(data: unknown): data is string {
  return typeof data === 'string' && data.length >= 8 && data.length <= MAX_FILE_PHOTO_BASE64_CHARS && data.startsWith('/9j/') && BASE64_BODY.test(data)
}

export function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const text = atob(data)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

/** Bytes per chunk of `base64Chunks`: a multiple of 3, so the pieces join into one valid base64 text. */
const CHUNK_BYTES = 3 * 256 * 1024

/** The base64 of `blob` in pieces that concatenate to the whole text (so a big photo is never one huge string). */
export async function* base64Chunks(blob: Blob, chunkBytes = CHUNK_BYTES): AsyncGenerator<string> {
  for (let at = 0; at < blob.size; at += chunkBytes) {
    yield bytesToBase64(new Uint8Array(await blob.slice(at, at + chunkBytes).arrayBuffer()))
  }
}

export interface EmbeddedPhoto {
  id: string
  width: number
  height: number
  blob: Blob
}

/**
 * The text of a trip file with `photos` embedded, as pieces for `new Blob(parts)`: pretty-printed like
 * `stringifyTripFile`, with the `photos` object last. `file` must not carry its own `photos`. A photo whose bytes
 * cannot be read is left out together with its references (`skipped` lists their ids).
 */
export async function tripFileTextParts(file: TripFile, photos: readonly EmbeddedPhoto[]): Promise<{ parts: string[]; skipped: string[] }> {
  const { photos: _none, ...plain } = file
  // Read every photo first: the file's own text must not refer to one that turns out to be unreadable.
  const readable: { photo: EmbeddedPhoto; chunks: string[] }[] = []
  const skipped: string[] = []
  for (const photo of photos) {
    try {
      const chunks: string[] = []
      for await (const chunk of base64Chunks(photo.blob)) chunks.push(chunk)
      readable.push({ photo, chunks })
    } catch {
      skipped.push(photo.id)
    }
  }
  const usable = skipped.length > 0 ? withoutMissingPhotos(plain, new Set(readable.map((r) => r.photo.id))).file : plain
  const text = JSON.stringify(usable, null, 2)
  if (readable.length === 0) return { parts: [`${text}\n`], skipped }
  // `text` ends with "\n}": cut that off, add the property, close the object again.
  const parts = [`${text.slice(0, -2)},\n  "photos": {`]
  readable.forEach(({ photo, chunks }, i) => {
    parts.push(`${i === 0 ? '' : ','}\n    ${JSON.stringify(photo.id)}: {\n      "mime": "image/jpeg",\n      "data": "`)
    parts.push(...chunks)
    parts.push(`",\n      "width": ${photo.width},\n      "height": ${photo.height}\n    }`)
  })
  parts.push('\n  }\n}\n')
  return { parts, skipped }
}

/**
 * The pixel size a JPEG declares in its frame header (what it decodes to, before any EXIF rotation), read without
 * decoding it; null when no frame header is found. Lets a file's photos be bounded before the browser allocates for them.
 */
export function readJpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) {
      at++
      continue
    }
    const marker = bytes[at + 1]
    if (marker === 0xff) {
      at++ // a fill byte
      continue
    }
    // Stand-alone markers have no length.
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null // the end, or the scan, before any frame header
    const length = (bytes[at + 2] << 8) | bytes[at + 3]
    // SOF0–SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 9 > bytes.length) return null
      const height = (bytes[at + 5] << 8) | bytes[at + 6]
      const width = (bytes[at + 7] << 8) | bytes[at + 8]
      return width > 0 && height > 0 ? { width, height } : null
    }
    if (length < 2) return null
    at += 2 + length
  }
  return null
}

/** `file` with the `width`/`height` of the references to these photos set to what the stored bytes really are. */
export function withPhotoSizes(file: TripFile, sizes: ReadonlyMap<string, { width: number; height: number }>): TripFile {
  if (sizes.size === 0) return file
  let changed = false
  const places = file.trip.places.map((place) => {
    if (!place.photos) return place
    let touched = false
    const photos = place.photos.map((ref) => {
      const size = sizes.get(ref.id)
      if (!size || (size.width === ref.width && size.height === ref.height)) return ref
      touched = true
      return { ...ref, width: size.width, height: size.height }
    })
    if (!touched) return place
    changed = true
    return { ...place, photos }
  })
  return changed ? { ...file, trip: { ...file.trip, places } } : file
}
