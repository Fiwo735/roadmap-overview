import type { StoredPhotoMeta } from '../lib/photos'

/**
 * Where the bytes of place photos live (F11): IndexedDB database "roadmap-overview" (the app's first name: renaming the
 * database would lose every stored photo), object store "photos", one record per photo id. The trip itself only refers to
 * ids (`Place.photos`), so photos never enter the undo history, the autosave, the recent trips or a share link. A second
 * store, "unreferenced", holds the garbage collection's marks (when a photo was first found without a reference).
 */

export const PHOTO_DB_NAME = 'roadmap-overview'
const DB_VERSION = 2
const STORE = 'photos'
const MARKS = 'unreferenced'
const BY_CREATED = 'createdAt'

export interface PhotoRecord {
  id: string
  /** The photo: JPEG, at most 2048 px on the long edge. */
  blob: Blob
  /** A small JPEG (≈ 320 px) for lists and the place card. */
  thumb: Blob
  width: number
  height: number
  /** When it was stored (ms since epoch). */
  createdAt: number
}

/** The operations the app needs; `createIndexedDbPhotoStore` is the real one, tests bring their own. */
export interface PhotoStore {
  /** Store records. An id that is already stored is kept as it is unless `overwrite` is set. */
  put(records: readonly PhotoRecord[], options?: { overwrite?: boolean }): Promise<void>
  get(id: string): Promise<PhotoRecord | undefined>
  /** Which of `ids` are stored. */
  has(ids: readonly string[]): Promise<Set<string>>
  /** Id, storage time and garbage-collection mark of everything stored, without reading the bytes. */
  list(): Promise<StoredPhotoMeta[]>
  /** Remember that nothing referred to these photos at `since`; a photo that is marked already keeps its older mark. */
  markUnreferenced(ids: readonly string[], since: number): Promise<void>
  /** Forget the marks of these photos (something refers to them again). */
  clearUnreferenced(ids: readonly string[]): Promise<void>
  /** Delete photos (and their marks). */
  delete(ids: readonly string[]): Promise<void>
}

/** Storage is unavailable or refused (private mode, quota, blocked site data). `message` is for the user. */
export class PhotoStoreError extends Error {
  readonly kind: 'unavailable' | 'quota' | 'failed'
  constructor(message: string, kind: 'unavailable' | 'quota' | 'failed') {
    super(message)
    this.name = 'PhotoStoreError'
    this.kind = kind
  }
}

function describe(err: unknown): PhotoStoreError {
  if (err instanceof PhotoStoreError) return err
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : ''
  if (name === 'QuotaExceededError') {
    return new PhotoStoreError('This browser has no room left for photos. Remove some photos or free up space.', 'quota')
  }
  // Browsers refuse the database like this when site data is blocked or the window is private.
  if (name === 'SecurityError' || name === 'InvalidStateError') {
    return new PhotoStoreError('This browser is not letting this page store photos (private browsing or blocked site data can cause that).', 'unavailable')
  }
  return new PhotoStoreError(`Photos could not be stored in this browser${name && name !== 'Error' ? ` (${name})` : ''}.`, 'failed')
}

const promisify = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })

const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })

interface Mark {
  id: string
  since: number
}

export function createIndexedDbPhotoStore(factory: IDBFactory | undefined = globalThis.indexedDB): PhotoStore {
  let opened: Promise<IDBDatabase> | null = null

  function open(): Promise<IDBDatabase> {
    if (!factory) return Promise.reject(new PhotoStoreError('This browser cannot store photos.', 'unavailable'))
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
        request = factory.open(PHOTO_DB_NAME, DB_VERSION)
      } catch (err) {
        reject(err)
        return
      }
      // Set when this attempt was given up on (another tab blocks the upgrade): a connection that arrives later is closed at once.
      let abandoned = false
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex(BY_CREATED, 'createdAt')
        if (!db.objectStoreNames.contains(MARKS)) db.createObjectStore(MARKS, { keyPath: 'id' })
      }
      request.onsuccess = () => {
        const db = request.result
        if (abandoned) {
          db.close()
          return
        }
        // A newer version of the app in another tab wants to upgrade, or the browser dropped the connection: let go, open again next time.
        const forget = () => {
          if (opened) opened = null
        }
        db.onversionchange = () => {
          db.close()
          forget()
        }
        db.onclose = forget
        resolve(db)
      }
      request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'))
      request.onblocked = () => {
        abandoned = true
        reject(new Error('IndexedDB is blocked by another tab'))
      }
    }).catch((err: unknown) => {
      opened = null
      throw err
    })
    return opened
  }

  /** Run `fn` in one transaction over `stores` and wait for it to commit. */
  async function run<T>(mode: IDBTransactionMode, stores: string[], fn: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
    try {
      const db = await open()
      const tx = db.transaction(stores, mode)
      const done = finished(tx)
      // If `fn` throws we leave without awaiting this: an abort that follows must not be an unhandled rejection.
      done.catch(() => undefined)
      const result = await fn(tx)
      await done
      return result
    } catch (err) {
      throw describe(err)
    }
  }

  return {
    put: (records, { overwrite = false } = {}) =>
      records.length === 0
        ? Promise.resolve()
        : run('readwrite', [STORE], async (tx) => {
            const store = tx.objectStore(STORE)
            await Promise.all(
              records.map((record) =>
                overwrite
                  ? promisify(store.put(record))
                  : new Promise<void>((resolve, reject) => {
                      const request = store.add(record)
                      request.onsuccess = () => resolve()
                      request.onerror = (event) => {
                        // An id that is stored already is not an error: the existing bytes stay (and the transaction goes on).
                        if (request.error?.name === 'ConstraintError') {
                          event.preventDefault()
                          resolve()
                        } else {
                          reject(request.error ?? new Error('IndexedDB request failed'))
                        }
                      }
                    }),
              ),
            )
          }),

    get: (id) => run('readonly', [STORE], async (tx) => (await promisify(tx.objectStore(STORE).get(id))) as PhotoRecord | undefined),

    has: (ids) =>
      ids.length === 0
        ? Promise.resolve(new Set<string>())
        : run('readonly', [STORE], async (tx) => {
            const store = tx.objectStore(STORE)
            const found = await Promise.all(ids.map(async (id) => ((await promisify(store.count(id))) > 0 ? id : null)))
            return new Set(found.filter((id): id is string => id !== null))
          }),

    list: () =>
      run('readonly', [STORE, MARKS], async (tx) => {
        const marks = new Map((await promisify(tx.objectStore(MARKS).getAll()) as Mark[]).map((m) => [m.id, m.since]))
        return new Promise<StoredPhotoMeta[]>((resolve, reject) => {
          const out: StoredPhotoMeta[] = []
          // A key cursor on the index reads the keys only, never the photos themselves.
          const request = tx.objectStore(STORE).index(BY_CREATED).openKeyCursor()
          request.onsuccess = () => {
            const cursor = request.result
            if (!cursor) return resolve(out)
            const id = String(cursor.primaryKey)
            const since = marks.get(id)
            out.push(since === undefined ? { id, createdAt: Number(cursor.key) } : { id, createdAt: Number(cursor.key), unreferencedSince: since })
            cursor.continue()
          }
          request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed'))
        })
      }),

    markUnreferenced: (ids, since) =>
      ids.length === 0
        ? Promise.resolve()
        : run('readwrite', [MARKS], async (tx) => {
            const marks = tx.objectStore(MARKS)
            await Promise.all(
              ids.map(async (id) => {
                if ((await promisify(marks.count(id))) === 0) await promisify(marks.put({ id, since } satisfies Mark))
              }),
            )
          }),

    clearUnreferenced: (ids) =>
      ids.length === 0 ? Promise.resolve() : run('readwrite', [MARKS], async (tx) => void (await Promise.all(ids.map((id) => promisify(tx.objectStore(MARKS).delete(id)))))),

    delete: (ids) =>
      ids.length === 0
        ? Promise.resolve()
        : run('readwrite', [STORE, MARKS], async (tx) => {
            await Promise.all(ids.flatMap((id) => [promisify(tx.objectStore(STORE).delete(id)), promisify(tx.objectStore(MARKS).delete(id))]))
          }),
  }
}

let current: PhotoStore | null = null

/** The app's photo store (created on first use). */
export function getPhotoStore(): PhotoStore {
  current ??= createIndexedDbPhotoStore()
  return current
}

/** Replace the store (tests); `null` goes back to IndexedDB. */
export function setPhotoStore(store: PhotoStore | null): void {
  current = store
}

/** A store that keeps everything in memory: for unit tests of code that needs a `PhotoStore`. */
export function createMemoryPhotoStore(): PhotoStore & { records: Map<string, PhotoRecord>; marks: Map<string, number> } {
  const records = new Map<string, PhotoRecord>()
  const marks = new Map<string, number>()
  return {
    records,
    marks,
    put: async (list, { overwrite = false } = {}) => {
      for (const record of list) if (overwrite || !records.has(record.id)) records.set(record.id, record)
    },
    get: async (id) => records.get(id),
    has: async (ids) => new Set(ids.filter((id) => records.has(id))),
    list: async () =>
      [...records.values()].map(({ id, createdAt }) => {
        const since = marks.get(id)
        return since === undefined ? { id, createdAt } : { id, createdAt, unreferencedSince: since }
      }),
    markUnreferenced: async (ids, since) => {
      for (const id of ids) if (!marks.has(id)) marks.set(id, since)
    },
    clearUnreferenced: async (ids) => {
      for (const id of ids) marks.delete(id)
    },
    delete: async (ids) => {
      for (const id of ids) {
        records.delete(id)
        marks.delete(id)
      }
    },
  }
}
