import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { useUiStore } from '../../store/uiStore'
import { PlacesPanel } from '../places/PlacesPanel'

/**
 * Left column on wide screens; below 768px a slide-over toggled from the top bar (the CSS hides it
 * when closed, which also removes it from the tab order).
 */
export function Sidebar() {
  const open = useUiStore((s) => s.sidebarOpen)
  const setOpen = useUiStore((s) => s.setSidebarOpen)
  const asideRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  // Slide-over focus handling: move focus in when it opens, give it back to the toggle when it
  // closes (unless the user already moved on to something else).
  useEffect(() => {
    if (open) {
      closeRef.current?.focus()
    } else if (wasOpen.current) {
      const active = document.activeElement
      if (active === document.body || asideRef.current?.contains(active)) {
        document.getElementById('sidebar-toggle')?.focus()
      }
    }
    wasOpen.current = open
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen])

  return (
    <>
      <div className="sidebar-backdrop" data-open={open} onClick={() => setOpen(false)} />
      <aside ref={asideRef} id="sidebar" className="sidebar" data-open={open} data-testid="sidebar" aria-label="Trip places">
        <div className="sidebar__mobile-head">
          <IconButton
            ref={closeRef}
            label="Close places"
            icon={<X size={18} />}
            onClick={() => setOpen(false)}
          />
        </div>
        <div className="sidebar__scroll">
          <PlacesPanel />
        </div>
      </aside>
    </>
  )
}
