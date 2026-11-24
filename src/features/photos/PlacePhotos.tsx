import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ArrowLeft, ArrowRight, ImagePlus, X } from 'lucide-react'
import { Button } from '../../components/Button'
import { IconButton } from '../../components/IconButton'
import { Spinner } from '../../components/Spinner'
import { MAX_CAPTION_LENGTH, MAX_PHOTOS_PER_PLACE, looksLikeImage, photoSlotsLeft, tripPhotoCount } from '../../lib/photos'
import { useTripStore } from '../../store/tripStore'
import type { Place, PlacePhoto } from '../../types/trip'
import { useEditingLocked } from '../ride/rideStore'
import { PhotoImage } from './PhotoImage'
import { addPhotos, usePhotoJobs } from './addPhotos'
import { removePhoto, setCaption, shiftPhoto } from './photoActions'
import './photos.css'

interface PlacePhotosProps {
  place: Place
  placeName: string
}

const carriesFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')

/** The caption of the selected photo: typed locally, saved (one undo step) when the field is left. */
function CaptionField({ placeId, photo, number, disabled }: { placeId: string; photo: PlacePhoto; number: number; disabled: boolean }) {
  const saved = photo.caption ?? ''
  const [draft, setDraft] = useState<{ text: string; base: string } | null>(null)
  // Escape blurs the field and blur saves: this makes that blur discard instead (the row closes through the event).
  const cancelled = useRef(false)
  const live = draft && draft.base === saved ? draft : null

  // The row closing with a caption half-typed keeps what was typed.
  const latest = useRef({ text: live?.text, saved })
  useEffect(() => {
    latest.current = { text: live?.text, saved }
  })
  useEffect(
    () => () => {
      const { text, saved: base } = latest.current
      if (!cancelled.current && text !== undefined && text.trim() !== base) setCaption(placeId, photo.id, text)
    },
    [placeId, photo.id],
  )

  return (
    <input
      type="text"
      className="place-photos__caption"
      data-testid="photo-caption"
      aria-label={`Caption for photo ${number}`}
      placeholder="Add a caption"
      maxLength={MAX_CAPTION_LENGTH}
      disabled={disabled}
      value={live?.text ?? saved}
      onChange={(e) => {
        cancelled.current = false
        setDraft({ text: e.target.value, base: saved })
      }}
      onFocus={() => {
        cancelled.current = false
      }}
      onBlur={() => {
        if (!cancelled.current && live && live.text.trim() !== saved) setCaption(placeId, photo.id, live.text)
        setDraft(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          cancelled.current = true
          setDraft(null)
        }
      }}
    />
  )
}

/**
 * The photos of a place in its expanded row: add (picker or drop), thumbnails to select, reorder, caption and
 * remove. Everything that changes the trip is one undo step and is off while editing is locked.
 */
export function PlacePhotos({ place, placeName }: PlacePhotosProps) {
  const photos = place.photos ?? []
  const locked = useEditingLocked()
  const job = usePhotoJobs((s) => s.jobs[place.id])
  const tripTotal = useTripStore((s) => tripPhotoCount(s.trip))
  const slots = photoSlotsLeft(photos.length, tripTotal)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const depth = useRef(0)
  const input = useRef<HTMLInputElement>(null)

  const selected = photos.findIndex((p) => p.id === selectedId)
  const current = selected >= 0 ? photos[selected] : null
  const busy = job !== undefined
  const canAdd = !locked && !busy

  function add(files: File[]) {
    if (files.length > 0) void addPhotos(place.id, files)
  }

  function onDragEnter(e: DragEvent) {
    if (!carriesFiles(e)) return
    e.preventDefault()
    depth.current++
    if (canAdd) setDropping(true)
  }
  function onDragLeave() {
    if (depth.current === 0) return
    depth.current--
    if (depth.current === 0) setDropping(false)
  }
  function onDrop(e: DragEvent) {
    if (!carriesFiles(e)) return
    depth.current = 0
    setDropping(false)
    const files = Array.from(e.dataTransfer.files)
    // Files that are not images (a trip file, say) are the window's business: it opens them.
    if (!files.some(looksLikeImage)) return
    e.preventDefault()
    add(files)
  }

  return (
    <section
      className="place-photos"
      data-testid="place-photos"
      data-dropping={dropping || undefined}
      aria-label={`Photos of ${placeName}`}
      onDragEnter={onDragEnter}
      onDragOver={(e) => {
        if (!carriesFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = canAdd ? 'copy' : 'none'
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="place-photos__header">
        <span className="place-photos__label">
          Photos
          {photos.length > 0 ? (
            <span className="place-photos__count" data-testid="photo-count">
              {photos.length}
            </span>
          ) : null}
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon={<ImagePlus size={14} />}
          disabled={!canAdd || slots === 0}
          onClick={() => input.current?.click()}
          data-testid="photo-add"
        >
          Add photos
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          data-testid="photo-input"
          aria-label={`Add photos to ${placeName}`}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            // So that picking the same file again is a change too.
            e.target.value = ''
            add(files)
          }}
        />
      </div>

      {photos.length === 0 ? (
        <p className="place-photos__empty">No photos yet. Drop images here or add them; they show up when this place is clicked on the map.</p>
      ) : (
        <ul className="place-photos__grid" data-testid="photo-grid">
          {photos.map((photo, i) => (
            <li key={photo.id} className="place-photos__tile" data-selected={photo.id === current?.id || undefined}>
              <button
                type="button"
                className="place-photos__thumb"
                data-testid="photo-thumb"
                data-photo-id={photo.id}
                aria-pressed={photo.id === current?.id}
                aria-label={`Photo ${i + 1} of ${photos.length}${photo.caption ? `: ${photo.caption}` : ''}`}
                onClick={() => setSelectedId(photo.id === current?.id ? null : photo.id)}
              >
                <PhotoImage id={photo.id} kind="thumb" alt="" />
              </button>
              <button
                type="button"
                className="place-photos__remove"
                data-testid="photo-remove"
                aria-label={`Remove photo ${i + 1}`}
                disabled={locked}
                onClick={() => removePhoto(place.id, photo.id)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {job ? (
        <div className="place-photos__progress" role="status" data-testid="photo-progress">
          <Spinner size={14} />
          {job.total > 1 ? `Adding photo ${Math.min(job.done + 1, job.total)} of ${job.total}…` : 'Adding photo…'}
        </div>
      ) : null}

      {current ? (
        <div className="place-photos__editor" data-testid="photo-editor">
          <div className="place-photos__editor-row">
            <span className="place-photos__position">
              Photo {selected + 1} of {photos.length}
            </span>
            <IconButton
              size="sm"
              label="Move earlier"
              icon={<ArrowLeft size={14} />}
              disabled={locked || selected === 0}
              onClick={() => shiftPhoto(place.id, current.id, -1)}
              data-testid="photo-move-earlier"
            />
            <IconButton
              size="sm"
              label="Move later"
              icon={<ArrowRight size={14} />}
              disabled={locked || selected === photos.length - 1}
              onClick={() => shiftPhoto(place.id, current.id, 1)}
              data-testid="photo-move-later"
            />
          </div>
          <CaptionField key={current.id} placeId={place.id} photo={current} number={selected + 1} disabled={locked} />
        </div>
      ) : photos.length > 0 ? (
        <p className="place-photos__hint">Select a photo to caption it or change its order.</p>
      ) : null}

      {slots === 0 && !busy ? (
        <p className="place-photos__hint" data-testid="photo-full">
          {photos.length >= MAX_PHOTOS_PER_PLACE ? `A place holds at most ${MAX_PHOTOS_PER_PLACE} photos.` : 'This trip has reached its limit of photos.'}
        </p>
      ) : null}

      {dropping ? (
        <div className="place-photos__drop" aria-hidden="true">
          Drop to add photos
        </div>
      ) : null}
    </section>
  )
}
