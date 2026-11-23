import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { portalTarget } from './portal'
import './Tooltip.css'

const SHOW_DELAY_MS = 450
const GAP = 8
const MARGIN = 8

export interface TooltipAnchorProps<T extends HTMLElement> {
  onPointerEnter: (e: PointerEvent<T>) => void
  onPointerLeave: () => void
  onPointerDown: () => void
  onFocus: (e: FocusEvent<T>) => void
  onBlur: () => void
  onKeyDown: (e: KeyboardEvent<T>) => void
}

/**
 * Visual-only tooltip for an element that already has an accessible name (it is aria-hidden).
 * Attach `props` handlers to the anchor and render `tooltip` anywhere; it is portalled to <body> (or
 * to the anchor's modal dialog) so scroll containers never clip it.
 */
export function useTooltip<T extends HTMLElement = HTMLElement>(
  text: string | undefined,
): { props: TooltipAnchorProps<T>; tooltip: ReactNode } {
  const anchorRef = useRef<HTMLElement | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [visible, setVisible] = useState(false)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setVisible(false)
    setPos(null)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const tip = tipRef.current
    if (!visible || !anchor || !tip) return
    const a = anchor.getBoundingClientRect()
    const t = tip.getBoundingClientRect()
    const left = Math.min(Math.max(MARGIN, a.left + a.width / 2 - t.width / 2), window.innerWidth - t.width - MARGIN)
    const below = a.bottom + GAP + t.height <= window.innerHeight - MARGIN
    setPos({ left, top: below ? a.bottom + GAP : a.top - GAP - t.height })
  }, [visible, text])

  useEffect(() => {
    if (!visible) return
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [visible, hide])

  const props: TooltipAnchorProps<T> = {
    onPointerEnter: (e) => {
      if (e.pointerType === 'touch' || !text) return
      anchorRef.current = e.currentTarget
      setContainer(portalTarget(e.currentTarget))
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS)
    },
    onPointerLeave: hide,
    onPointerDown: hide,
    onFocus: (e) => {
      if (!text || !e.currentTarget.matches(':focus-visible')) return
      anchorRef.current = e.currentTarget
      setContainer(portalTarget(e.currentTarget))
      setVisible(true)
    },
    onBlur: hide,
    onKeyDown: (e) => {
      if (e.key === 'Escape') hide()
    },
  }

  const tooltip =
    visible && text && container
      ? createPortal(
          <div
            ref={tipRef}
            className="tooltip"
            aria-hidden="true"
            style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
          >
            {text}
          </div>,
          container,
        )
      : null

  return { props, tooltip }
}
