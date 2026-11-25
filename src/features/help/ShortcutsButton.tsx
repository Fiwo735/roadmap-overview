import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Keyboard } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { portalTarget } from '../../components/portal'
import { useMediaQuery } from '../../components/useMediaQuery'
import { useUiStore } from '../../store/uiStore'
import { ShortcutTable } from './ShortcutTable'
import { isAnywhereShortcut, shortcutSections } from './shortcutList'
import './help.css'

/** How long the pointer rests on the button before the popover opens, and how long it may be away from both before it closes. */
const OPEN_DELAY_MS = 300
const CLOSE_DELAY_MS = 200
const GAP = 6
const MARGIN = 8

/**
 * `hover`: opened by the pointer resting on the button; it closes when the pointer leaves the button and the popover.
 * `pinned`: opened by a click, Enter or Space (or a click on the open hover popover); it stays until Escape, a click
 * elsewhere, Tab or the button again.
 */
type Mode = 'closed' | 'hover' | 'pinned'

interface PopoverProps {
  id: string
  trigger: HTMLElement
  /** Focus moves into the popover when it was opened on purpose (click or keys), so a keyboard can scroll it. */
  focusOnOpen: boolean
  onPointerEnter: (e: PointerEvent) => void
  onPointerLeave: (e: PointerEvent) => void
  onTab: () => void
  /** A key that acts anywhere (`P`, `?`, Ctrl+Z…) was pressed in the popover: it makes way, and the focus goes back to the button. */
  onAnywhereKey: () => void
}

/** The quick list of shortcuts, under the button, with the same rows as the Help dialog. Scrolls when the window is short. */
function ShortcutsPopover({ id, trigger, focusOnOpen, onPointerEnter, onPointerLeave, onTab, onAnywhereKey }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties | null>(null)

  // Under the button with the popover's right edge on the button's (it sits at the right of the top bar), and no taller than the room below.
  useLayoutEffect(() => {
    const panel = ref.current
    if (!panel) return
    const a = trigger.getBoundingClientRect()
    const { width } = panel.getBoundingClientRect()
    const top = a.bottom + GAP
    setStyle({
      top,
      left: Math.max(MARGIN, Math.min(a.right - width, window.innerWidth - width - MARGIN)),
      maxHeight: Math.max(120, window.innerHeight - top - MARGIN),
    })
  }, [trigger])

  const positioned = style !== null
  useEffect(() => {
    if (positioned && focusOnOpen) ref.current?.focus({ preventScroll: true })
  }, [positioned, focusOnOpen])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Tab has nowhere to go inside (the panel is the only stop): carry on from the button, where the popover came from.
    if (e.key === 'Tab') {
      e.preventDefault()
      onTab()
    } else if (isAnywhereShortcut(e)) {
      // Not prevented: the key still reaches its own handler (this one runs first), only the focus has moved off the popover by then,
      // which matters for a dialog it opens: that returns the focus to where it was, and the popover is about to be gone.
      onAnywhereKey()
    }
  }

  return (
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label="Keyboard shortcuts"
      tabIndex={0}
      className="shortcuts-pop"
      data-testid="shortcuts-popover"
      style={style ?? { top: 0, left: 0, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="shortcuts-pop__head">
        <h2 className="shortcuts-pop__title">Keyboard shortcuts</h2>
        <span className="shortcuts-pop__hint">
          Press <kbd className="kbd">?</kbd> for the help
        </span>
      </div>
      <div className="shortcuts-pop__sections">
        {shortcutSections().map((section) => (
          <ShortcutTable key={section.id} section={section} testId={`shortcuts-keys-${section.id}`} compact />
        ))}
      </div>
    </div>
  )
}

/**
 * Top bar, beside Help: a keyboard button whose popover lists every shortcut (`shortcutSections()`, the Help dialog's own
 * list). Hover opens it after a short rest, a click or Enter/Space keeps it open (and moves the focus in); Escape, a click
 * elsewhere, Tab or leaving it (when only hovered) close it, with the focus back on the button.
 * It is for keyboards: a phone's top bar folds it away (it sits with Help) and a touch-only device never gets it.
 */
function ShortcutsPopoverButton() {
  const buttonRef = useRef<HTMLButtonElement>(null)
  // The button is kept with the mode while open: the popover hangs from it.
  const [{ mode, anchor }, setState] = useState<{ mode: Mode; anchor: HTMLButtonElement | null }>({ mode: 'closed', anchor: null })
  const modeRef = useRef<Mode>('closed')
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const popoverId = useId()
  const dialogOpen = useUiStore((s) => s.openDialogId !== null)

  const change = useMemo(
    () => (next: Mode) => {
      modeRef.current = next
      setState({ mode: next, anchor: next === 'closed' ? null : buttonRef.current })
    },
    [],
  )

  const cancelTimers = () => {
    clearTimeout(openTimer.current)
    clearTimeout(closeTimer.current)
  }

  const close = (returnFocus: boolean) => {
    cancelTimers()
    change('closed')
    if (returnFocus) buttonRef.current?.focus()
  }

  // The pointer resting on the button opens it; leaving the button and the popover (a grace period lets it cross the gap) closes a hovered one.
  const enter = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    clearTimeout(closeTimer.current)
    if (modeRef.current === 'closed') {
      clearTimeout(openTimer.current)
      openTimer.current = setTimeout(() => {
        if (modeRef.current === 'closed') change('hover')
      }, OPEN_DELAY_MS)
    }
  }
  const leave = () => {
    clearTimeout(openTimer.current)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      if (modeRef.current === 'hover') change('closed')
    }, CLOSE_DELAY_MS)
  }

  useEffect(() => () => cancelTimers(), [])

  // Escape closes it wherever the focus is. Registered when the top bar mounts, in the capture phase, so it comes before the
  // keys of a ride or of presentation mode (registered later): while the popover is open, Escape is its own.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || modeRef.current === 'closed') return
      e.preventDefault()
      e.stopPropagation()
      const active = document.activeElement
      const focusWasHere = active === buttonRef.current || (active instanceof Element && active.closest('.shortcuts-pop') !== null)
      cancelTimers()
      change('closed')
      if (focusWasHere) buttonRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [change])

  // A click elsewhere, a resize or a scroll of something other than the popover closes it; so does a dialog opening (`?` while it is open).
  useEffect(() => {
    if (mode === 'closed') return
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const target = e.target instanceof Node ? e.target : null
      if (target && (buttonRef.current?.contains(target) || document.getElementById(popoverId)?.contains(target))) return
      cancelTimers()
      change('closed')
    }
    const onScroll = (e: Event) => {
      if (!document.getElementById(popoverId)?.contains(e.target as Node)) change('closed')
    }
    const onResize = () => change('closed')
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [mode, popoverId, change])

  // A layout effect, so it runs before the dialog's own effect shows it: a modal dialog returns the focus to what had it when it opened, so
  // that must not be something inside the popover, which goes. (A key of the popover's own gets the focus out earlier, see `onAnywhereKey`.)
  useLayoutEffect(() => {
    if (!dialogOpen || modeRef.current === 'closed') return
    const active = document.activeElement
    if (active instanceof Element && active.closest('.shortcuts-pop')) buttonRef.current?.focus()
    cancelTimers()
    change('closed')
  }, [dialogOpen, change])

  const open = mode !== 'closed'
  return (
    <>
      <IconButton
        ref={buttonRef}
        label="Keyboard shortcuts"
        // The popover says it by itself while it is open.
        tooltip={open ? '' : 'Keyboard shortcuts'}
        icon={<Keyboard size={18} />}
        className="shortcuts-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        data-testid="shortcuts-button"
        onPointerEnter={enter}
        onPointerLeave={leave}
        onClick={() => {
          cancelTimers()
          change(modeRef.current === 'pinned' ? 'closed' : 'pinned')
        }}
      />
      {anchor
        ? createPortal(
            <ShortcutsPopover
              id={popoverId}
              trigger={anchor}
              focusOnOpen={mode === 'pinned'}
              onPointerEnter={enter}
              onPointerLeave={leave}
              onTab={() => close(true)}
              onAnywhereKey={() => close(true)}
            />,
            portalTarget(anchor),
          )
        : null}
    </>
  )
}

/** The button, unless this is a touch-only device (no hover and a coarse pointer), where there is no keyboard to learn. */
export function ShortcutsButton() {
  const touchOnly = useMediaQuery('(hover: none), (pointer: coarse)')
  return touchOnly ? null : <ShortcutsPopoverButton />
}
