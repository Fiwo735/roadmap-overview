import { useEffect, useRef, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { useModalStack } from '../../components/portal'
import { useTripStore } from '../../store/tripStore'
import type { PlacePhoto } from '../../types/trip'
import { displayName } from '../places/names'
import { PhotoImage } from './PhotoImage'
import { acquirePhotoUrl } from './photoUrls'
import { closeViewer, showViewerPhoto, usePlaceCardStore } from './placeCardStore'
import './photos.css'

const NO_PHOTOS: PlacePhoto[] = []

/** A horizontal drag at least this long (and clearly more horizontal than vertical) turns the page. */
const SWIPE_PX = 48

/**
 * The photo viewer, opened from the place card: the photo large, its caption, previous/next (buttons, ←/→, a
 * swipe), a counter and Esc / ✕ / a click beside the photo to close. A modal `<dialog>`, so focus is kept
 * inside and the page behind is inert; the next and previous photos are loaded in advance.
 */
function Lightbox({ placeId, index }: { placeId: string; index: number }) {
  const place = useTripStore((s) => s.trip.places.find((p) => p.id === placeId))
  const dialog = useRef<HTMLDialogElement>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  // A drag that ends beside the photo also "clicks" the dark area: that must not close the viewer.
  const dragged = useRef(false)
  const photos = place?.photos ?? NO_PHOTOS
  const at = Math.min(Math.max(index, 0), Math.max(0, photos.length - 1))
  const photo = photos[at]

  const go = (to: number) => {
    if (to >= 0 && to < photos.length) showViewerPhoto(to)
  }

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (!el.open) el.showModal()
    useModalStack.getState().add(el)
    return () => {
      useModalStack.getState().remove(el)
      if (el.open) el.close()
    }
  }, [])

  // Nothing to show any more (the place or its photos went away): leave.
  useEffect(() => {
    if (!photo) closeViewer()
  }, [photo])

  // The neighbours are fetched while this one is looked at, so a step is instant.
  useEffect(() => {
    const held = [photos[at - 1], photos[at + 1]].filter(Boolean).map((p) => acquirePhotoUrl(p.id, 'full'))
    return () => held.forEach((h) => h.release())
  }, [photos, at])

  function onPointerDown(e: PointerEvent) {
    swipe.current = { x: e.clientX, y: e.clientY }
    dragged.current = false
  }
  function onPointerUp(e: PointerEvent) {
    const start = swipe.current
    swipe.current = null
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    dragged.current = Math.hypot(dx, dy) > 8
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) go(at + (dx < 0 ? 1 : -1))
  }

  if (!place || !photo) return null
  return createPortal(
    <dialog
      ref={dialog}
      className="lightbox"
      aria-label={`Photos of ${displayName(place.name)}`}
      data-testid="photo-viewer"
      // The close event comes a moment after `close()`: in development the effect runs twice, and by then the dialog is open again.
      onClose={(e) => {
        if (!e.currentTarget.open) closeViewer()
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          go(at - 1)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          go(at + 1)
        }
      }}
    >
      <div
        className="lightbox__stage"
        data-testid="photo-viewer-stage"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipe.current = null
        }}
        // A click on the dark area beside the photo closes the viewer; a click on the photo or a button does not.
        onClick={(e) => {
          if (e.target === e.currentTarget && !dragged.current) closeViewer()
        }}
      >
        <PhotoImage key={`t-${photo.id}`} id={photo.id} kind="thumb" alt="" className="lightbox__image lightbox__image--thumb" />
        <PhotoImage key={photo.id} id={photo.id} kind="full" alt={photo.caption ?? `Photo ${at + 1} of ${photos.length}, ${displayName(place.name)}`} className="lightbox__image" />
      </div>

      <div className="lightbox__bar">
        <span className="lightbox__title" data-testid="photo-viewer-title">
          {displayName(place.name)}
        </span>
        <span className="lightbox__count" data-testid="photo-viewer-count" aria-live="polite">
          {at + 1} / {photos.length}
        </span>
        <IconButton label="Close" icon={<X size={20} />} onClick={closeViewer} className="lightbox__close" data-testid="photo-viewer-close" />
      </div>

      {photos.length > 1 ? (
        <>
          <IconButton
            label="Previous photo"
            icon={<ChevronLeft size={26} />}
            disabled={at === 0}
            onClick={() => go(at - 1)}
            className="lightbox__nav lightbox__nav--prev"
            data-testid="photo-viewer-prev"
          />
          <IconButton
            label="Next photo"
            icon={<ChevronRight size={26} />}
            disabled={at === photos.length - 1}
            onClick={() => go(at + 1)}
            className="lightbox__nav lightbox__nav--next"
            data-testid="photo-viewer-next"
          />
        </>
      ) : null}

      {photo.caption ? (
        <p className="lightbox__caption" data-testid="photo-viewer-caption">
          {photo.caption}
        </p>
      ) : null}
    </dialog>,
    document.body,
  )
}

/** The photo viewer, when one is open. */
export function PhotoViewerHost() {
  const viewer = usePlaceCardStore((s) => s.viewer)
  return viewer ? <Lightbox key={viewer.placeId} placeId={viewer.placeId} index={viewer.index} /> : null
}
