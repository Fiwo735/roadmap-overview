import { toast } from '../../components/toast'
import {
  base64ToBytes,
  MAX_DECODE_PIXELS,
  MAX_FILE_PHOTO_DIMENSION,
  photoIdsOfTrip,
  readJpegSize,
  tripFileTextParts,
  withoutMissingPhotos,
  withPhotoSizes,
  type EmbeddedPhoto,
} from '../../lib/photos'
import { getPhotoStore, PhotoStoreError, type PhotoRecord } from '../../services/photoDb'
import type { TripFile } from '../../types/trip'
import { describeJpeg } from './processImage'

/**
 * Photos in trip files (F11). Saving embeds the full-size bytes of every photo the trip refers to; opening
 * puts the embedded bytes into IndexedDB *before* the trip is installed, so the place cards find them at once.
 */

export interface SavedTripFile {
  blob: Blob
  /** Photos the trip refers to whose bytes this browser no longer has, or cannot read: they are left out of the file. */
  missing: number
}

/** `file` as a JSON `Blob` with its photos embedded (read from IndexedDB). A photo that cannot be read counts as missing. */
export async function tripFileBlob(file: TripFile): Promise<SavedTripFile> {
  const ids = [...photoIdsOfTrip(file.trip)]
  const found: EmbeddedPhoto[] = []
  if (ids.length > 0) {
    const store = getPhotoStore()
    for (const id of ids) {
      try {
        const record = await store.get(id)
        if (record && record.blob instanceof Blob) found.push({ id, width: record.width, height: record.height, blob: record.blob })
      } catch {
        // Unreadable counts as missing.
      }
    }
  }
  const { file: usable, missing } = withoutMissingPhotos(file, new Set(found.map((p) => p.id)))
  // The bytes are read while the text is made: a photo whose bytes will not read is left out there.
  const { parts, skipped } = await tripFileTextParts(usable, found)
  return { blob: new Blob(parts, { type: 'application/json' }), missing: missing + skipped.length }
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

/** What `storePhotosOf` made of a file. */
export interface StoredPhotos {
  /** The file without embedded bytes, and without references to photos that neither it nor this browser has. */
  file: TripFile
  /** Things to tell the user, in the style of the parser's warnings. */
  notes: string[]
  /** The photos this call newly put into storage (not ones that were stored already): `discardPhotos` them if the trip is not opened after all. */
  added: string[]
}

/**
 * Prepare a parsed trip file to be opened: store the photos it carries and drop the references to photos that
 * neither the file nor this browser has. Embedded photos are bounded by what they decode to (read from the JPEG
 * header, before anything is decoded): a huge one is refused, one beyond 2048 px is shrunk like any added photo, and
 * the references get the true sizes. The returned file has no embedded bytes any more (they are in IndexedDB).
 */
export async function storePhotosOf(file: TripFile): Promise<StoredPhotos> {
  const wanted = photoIdsOfTrip(file.trip)
  const { photos: embedded, ...plain } = file
  if (wanted.size === 0) return { file: plain, notes: [], added: [] }

  const notes: string[] = []
  const entries = Object.entries(embedded ?? {})
  const loading = entries.length > 6 ? toast.info(`Reading ${entries.length} photos…`, { duration: 0 }) : null
  try {
    const store = getPhotoStore()
    const records: PhotoRecord[] = []
    let damaged = 0
    for (const [id, photo] of entries) {
      try {
        const bytes = base64ToBytes(photo.data)
        const declared = readJpegSize(bytes)
        if (
          !declared ||
          declared.width > MAX_FILE_PHOTO_DIMENSION ||
          declared.height > MAX_FILE_PHOTO_DIMENSION ||
          declared.width * declared.height > MAX_DECODE_PIXELS
        ) {
          damaged++
          continue
        }
        const described = await describeJpeg(new Blob([bytes], { type: 'image/jpeg' }))
        records.push({ id, blob: described.blob, thumb: described.thumb, width: described.width, height: described.height, createdAt: Date.now() })
      } catch {
        damaged++
      }
    }
    if (damaged > 0) notes.push(`${damaged} ${plural(damaged, 'photo in the file was damaged or too large and was', 'photos in the file were damaged or too large and were')} left out.`)

    let available = new Set<string>()
    let added: string[] = []
    let storeFailed = false
    try {
      const already = await store.has(records.map((r) => r.id))
      await store.put(records)
      added = records.map((r) => r.id).filter((id) => !already.has(id))
      available = await store.has([...wanted])
    } catch (err) {
      storeFailed = true
      notes.push(err instanceof PhotoStoreError ? err.message : 'The photos could not be stored in this browser.')
    }
    const pruned = withoutMissingPhotos(plain, available)
    // Damaged ones were counted above; the rest never had bytes (a file made without them).
    const unaccounted = pruned.missing - damaged
    if (!storeFailed && unaccounted > 0) notes.push(`${unaccounted} ${plural(unaccounted, 'photo was', 'photos were')} not in the file or in this browser and ${plural(unaccounted, 'was', 'were')} left out.`)
    // The references say what the bytes really are, not what the file claimed.
    const sizes = new Map(records.filter((r) => added.includes(r.id)).map((r) => [r.id, { width: r.width, height: r.height }]))
    return { file: withPhotoSizes(pruned.file, sizes), notes, added }
  } finally {
    if (loading !== null) toast.dismiss(loading)
  }
}

/** Take photos stored by `storePhotosOf` out again, because the trip that refers to them was not opened. Best effort. */
export async function discardPhotos(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  try {
    await getPhotoStore().delete(ids)
  } catch {
    // They become garbage that the next sweep takes.
  }
}
