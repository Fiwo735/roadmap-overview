import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileDown } from 'lucide-react'
import { toast } from '../../components/toast'
import { isEditingLocked } from '../ride/rideStore'
import { openTripFileFromDisk } from './importTrip'
import './io.css'

const carriesFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files')
const looksLikeJson = (file: File): boolean => /\.json$/i.test(file.name) || file.type === 'application/json'

/**
 * Dropping a trip file anywhere on the page opens it. While a file is dragged over the window a
 * themed overlay says so. Only file drags count (dragging text or a link does nothing), and the
 * browser's default of navigating away to a dropped file is always prevented.
 */
export function DropOverlay() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    // dragenter/dragleave also fire for every element the pointer crosses: count them.
    let depth = 0
    const modalOpen = () => document.querySelector('dialog[open]') !== null
    // A dropped trip replaces this one: not while presenting or riding either (isEditingLocked).
    const blocked = () => modalOpen() || isEditingLocked()

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depth++
      if (!blocked()) setActive(true)
    }
    const onOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = blocked() ? 'none' : 'copy'
    }
    // Not filtered on the drag's type: only file drags ever raised `depth`.
    const onLeave = () => {
      if (depth === 0) return
      depth--
      if (depth === 0) setActive(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depth = 0
      setActive(false)
      if (modalOpen()) return
      if (isEditingLocked()) {
        toast.info('Leave presentation mode or close the ride first, then drop the file again.')
        return
      }
      const files = Array.from(e.dataTransfer?.files ?? [])
      const file = files.find(looksLikeJson) ?? (files.length === 1 ? files[0] : undefined)
      if (file) void openTripFileFromDisk(file)
      else toast.error('Drop a trip file (.json) to open it.')
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  if (!active) return null
  return createPortal(
    <div className="drop-overlay" data-testid="drop-overlay" aria-hidden="true">
      <div className="drop-overlay__card">
        <span className="drop-overlay__icon">
          <FileDown size={32} strokeWidth={1.75} />
        </span>
        <p className="drop-overlay__title">Drop to open trip</p>
        <p className="drop-overlay__hint">A Roadmap Overview trip file (.json) replaces the current trip.</p>
      </div>
    </div>,
    document.body,
  )
}
