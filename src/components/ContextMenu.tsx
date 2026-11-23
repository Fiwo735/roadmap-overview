import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { MenuEntry } from './Menu'
import './Menu.css'

interface ContextMenuProps {
  /** Viewport position of the pointer that opened the menu. */
  x: number
  y: number
  /** Accessible name of the menu. */
  label: string
  items: MenuEntry[]
  /** Called on Escape, Tab, outside press, resize and after an item ran. The owner unmounts the menu. */
  onClose: () => void
}

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])'

/**
 * A menu opened at a point (right-click on the map) rather than from a trigger button. Looks and
 * behaves like `Menu`: arrow/Home/End navigation, Escape/Tab/outside press close it. The parent
 * closes it for its own reasons too (e.g. the map moving) by unmounting it.
 */
export function ContextMenu({ x, y, label, items, onClose }: ContextMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [previous] = useState(() => document.activeElement)

  // Keep the panel inside the viewport: open towards the pointer's free side.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const { width, height } = panel.getBoundingClientRect()
    const left = Math.max(8, Math.min(x, window.innerWidth - width - 8))
    const top = Math.max(8, y + height > window.innerHeight - 8 ? y - height : y)
    setPos({ left, top })
  }, [x, y])

  useEffect(() => {
    if (pos) panelRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus()
  }, [pos])

  // Like Menu: give focus back to where it was when the menu closes, unless the chosen action (or
  // the user) already moved it somewhere else.
  useEffect(() => {
    const panel = panelRef.current
    return () => {
      const now = document.activeElement
      const lost = now === null || now === document.body || panel?.contains(now)
      if (lost && previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [previous])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])
    const i = els.indexOf(document.activeElement as HTMLElement)
    const focusAt = (n: number) => els[(n + els.length) % els.length]?.focus()
    switch (e.key) {
      case 'ArrowDown':
        focusAt(i + 1)
        break
      case 'ArrowUp':
        focusAt(i < 0 ? -1 : i - 1)
        break
      case 'Home':
        focusAt(0)
        break
      case 'End':
        focusAt(-1)
        break
      case 'Escape':
      case 'Tab':
        onClose()
        break
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      className="menu"
      style={pos ?? { top: 0, left: 0, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) =>
        item.type === 'separator' ? (
          <div key={item.id} role="separator" className="menu__separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            tabIndex={-1}
            className={['menu__item', item.danger && 'menu__item--danger'].filter(Boolean).join(' ')}
            onClick={() => {
              if (item.disabled) return
              onClose()
              item.onSelect()
            }}
          >
            <span className="menu__icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="menu__label">{item.label}</span>
            {item.shortcut ? <span className="menu__shortcut">{item.shortcut}</span> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
