import { useEffect, useState } from 'react'
import { getPhotoStore } from '../../services/photoDb'

export type PhotoKind = 'thumb' | 'full'

/** Object URLs of stored photos, shared by everything that shows the same photo and let go of a while after the last one stops. */
interface Entry {
  url: Promise<string | null>
  refs: number
  timer: ReturnType<typeof setTimeout> | undefined
}

const LINGER_MS = 30_000
const entries = new Map<string, Entry>()

const keyOf = (id: string, kind: PhotoKind): string => `${kind}:${id}`

async function load(id: string, kind: PhotoKind): Promise<string | null> {
  try {
    const record = await getPhotoStore().get(id)
    return record ? URL.createObjectURL(kind === 'thumb' ? record.thumb : record.blob) : null
  } catch {
    return null
  }
}

/** Start using the photo's URL; call `release` when the user of it goes away. A missing photo resolves to null. */
export function acquirePhotoUrl(id: string, kind: PhotoKind): { url: Promise<string | null>; release: () => void } {
  const key = keyOf(id, kind)
  let entry = entries.get(key)
  if (!entry) {
    const created: Entry = { url: load(id, kind), refs: 0, timer: undefined }
    entry = created
    entries.set(key, created)
    // A photo that is not there (yet) is asked for again next time, not remembered as missing.
    void created.url.then((url) => {
      if (url === null && entries.get(key) === created) entries.delete(key)
    })
  }
  clearTimeout(entry.timer)
  entry.timer = undefined
  entry.refs++
  const held = entry
  let released = false
  return {
    url: held.url,
    release: () => {
      if (released) return
      released = true
      if (--held.refs > 0) return
      held.timer = setTimeout(() => {
        if (entries.get(key) === held) entries.delete(key)
        void held.url.then((url) => url && URL.revokeObjectURL(url))
      }, LINGER_MS)
    },
  }
}

export type PhotoUrlState = { status: 'loading'; url: null } | { status: 'ready'; url: string } | { status: 'missing'; url: null }

/** The object URL of a stored photo (thumbnail or full size) for an `<img>`. */
export function usePhotoUrl(id: string, kind: PhotoKind): PhotoUrlState {
  const [state, setState] = useState<{ key: string; url: string | null } | null>(null)
  const key = keyOf(id, kind)
  useEffect(() => {
    let live = true
    const held = acquirePhotoUrl(id, kind)
    void held.url.then((url) => {
      if (live) setState({ key, url })
    })
    return () => {
      live = false
      held.release()
    }
  }, [id, kind, key])
  if (!state || state.key !== key) return { status: 'loading', url: null }
  return state.url ? { status: 'ready', url: state.url } : { status: 'missing', url: null }
}
