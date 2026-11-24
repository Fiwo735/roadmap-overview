import { create } from 'zustand'
import { toast } from '../../components/toast'
import { newId } from '../../lib/id'
import { describeProblems, photoSlotsLeft, planBatch, tripPhotoCount, type PhotoProblem } from '../../lib/photos'
import { getPhotoStore, PhotoStoreError, type PhotoStore } from '../../services/photoDb'
import { useTripStore } from '../../store/tripStore'
import type { PlacePhoto } from '../../types/trip'
import { editingLockedReason } from '../ride/rideStore'
import { PhotoError, processImage, type ProcessedPhoto } from './processImage'

/** Photos being added to places, for the progress line in the expanded row. */
export const usePhotoJobs = create<{ jobs: Record<string, { done: number; total: number }> }>()(() => ({ jobs: {} }))

const setJob = (placeId: string, job: { done: number; total: number } | null): void =>
  usePhotoJobs.setState((s) => {
    const { [placeId]: _old, ...rest } = s.jobs
    return { jobs: job ? { ...rest, [placeId]: job } : rest }
  })

/** What `addPhotos` needs from the outside; tests replace it. */
export interface AddPhotosDeps {
  process: (file: File) => Promise<ProcessedPhoto>
  store: () => PhotoStore
  now: () => number
}

const defaults: AddPhotosDeps = { process: processImage, store: getPhotoStore, now: Date.now }

// Decoding a dozen 12-megapixel pictures at once would need gigabytes: one batch at a time.
let queue: Promise<void> = Promise.resolve()

/**
 * Add image files as photos of a place: each is decoded, shrunk and stored in IndexedDB, then the whole
 * batch becomes ONE `updatePlace` (one undo step). Files that cannot be used are reported in one toast; the
 * rest are added. Does nothing while editing is locked (ride, presentation mode).
 */
export function addPhotos(placeId: string, files: readonly File[], deps: AddPhotosDeps = defaults): Promise<void> {
  const locked = editingLockedReason()
  if (locked) {
    toast.info(locked)
    return Promise.resolve()
  }
  if (files.length === 0) return Promise.resolve()
  const run = queue.then(() => addBatch(placeId, files, deps))
  queue = run.catch(() => undefined)
  return run
}

async function addBatch(placeId: string, files: readonly File[], deps: AddPhotosDeps): Promise<void> {
  const place = useTripStore.getState().trip.places.find((p) => p.id === placeId)
  if (!place) return
  const plan = planBatch(files, photoSlotsLeft(place.photos?.length ?? 0, tripPhotoCount(useTripStore.getState().trip)))
  const problems: { name: string; problem: PhotoProblem }[] = plan.rejected.map(({ name, problem }) => ({ name, problem }))
  const added: PlacePhoto[] = []
  let storeError: PhotoStoreError | null = null

  setJob(placeId, { done: 0, total: plan.accepted.length })
  try {
    for (const [n, index] of plan.accepted.entries()) {
      const file = files[index]
      try {
        const processed = await deps.process(file)
        const id = newId('ph')
        await deps.store().put([{ id, blob: processed.blob, thumb: processed.thumb, width: processed.width, height: processed.height, createdAt: deps.now() }])
        added.push({ id, width: processed.width, height: processed.height })
      } catch (err) {
        if (err instanceof PhotoStoreError) {
          // Storage itself is refusing (no room, private mode): trying the rest would only repeat it.
          storeError = err
          break
        }
        problems.push({ name: file.name, problem: err instanceof PhotoError ? err.problem : 'unreadable' })
      }
      setJob(placeId, { done: n + 1, total: plan.accepted.length })
    }
  } finally {
    setJob(placeId, null)
  }

  if (added.length > 0) commit(placeId, added)
  if (storeError) toast.error(storeError.message)
  else if (problems.length > 0) toast.error(describeProblems(problems), { duration: 9_000 })
}

/** The batch as one step — unless the place went away or editing was locked while the files were being worked on. */
function commit(placeId: string, added: PlacePhoto[]): void {
  const lockedNow = editingLockedReason()
  const place = useTripStore.getState().trip.places.find((p) => p.id === placeId)
  if (!place) return
  if (lockedNow) {
    toast.info(`The photos were not added. ${lockedNow}`)
    return
  }
  useTripStore.getState().updatePlace(placeId, { photos: [...(place.photos ?? []), ...added] })
}
