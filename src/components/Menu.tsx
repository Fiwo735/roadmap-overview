import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { portalTarget } from './portal'
import './Menu.css'

export type MenuEntry =
  | {
      type?: 'item'
      id: string
      label: string
      icon?: ReactNode
      /** Display-only hint such as "Ctrl+Z". */
      shortcut?: string
      disabled?: boolean
      danger?: boolean
      /** Makes the item a radio-style choice with a check mark when true. */
      checked?: boolean
      onSelect: () => void
    }
  | { type: 'separator'; id: string }

/** Spread these on the element that opens the menu (any component that forwards `ref`). */
export interface MenuTriggerProps {
  ref: RefObject<HTMLButtonElement | null>
  onClick: () => void
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  'aria-controls': string | undefined
}

interface MenuProps {
  /** Accessible name of the menu itself. */
  label: string
  items: MenuEntry[]
  trigger: (props: MenuTriggerProps) => ReactNode
  /** Which edge of the trigger the menu lines up with. */
  align?: 'start' | 'end'
}

const ITEM_SELECTOR = '[role^="menuitem"]:not([aria-disabled="true"])'

/**
 * Dropdown menu: opens below its trigger (flips above near the bottom edge), supports arrow/Home/End/
 * type-ahead navigation, closes on Escape (focus returns to the trigger), Tab, outside click, scroll
 * and resize. The panel is portalled to <body> so scrolling parents never clip it.
 */
export function Menu({ label, items, trigger, align = 'start' }: MenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const [open, setOpen] = useState(false)
  // Where the panel is portalled: <body>, or the dialog the trigger sits in (see portalTarget).
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [style, setStyle] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const typeahead = useRef({ text: '', timer: undefined as ReturnType<typeof setTimeout> | undefined })

  const openMenu = () => {
    setContainer(portalTarget(triggerRef.current))
    setOpen(true)
  }

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    setStyle(null)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const t = triggerRef.current
    const panel = panelRef.current
    if (!open || !t || !panel) return
    const a = t.getBoundingClientRect()
    const { width, height } = panel.getBoundingClientRect()
    const left = Math.max(8, Math.min(align === 'end' ? a.right - width : a.left, window.innerWidth - width - 8))
    const flip = a.bottom + 4 + height > window.innerHeight - 8 && a.top > height + 12
    const next = flip ? { left, bottom: window.innerHeight - a.top + 4 } : { left, top: a.bottom + 4 }
    setStyle(next)
  }, [open, align])

  // Once positioned, move focus into the menu.
  useEffect(() => {
    if (open && style) panelRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus()
  }, [open, style])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    const onScroll = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node)) close(false)
    }
    const onResize = () => close(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close])

  const focusables = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = focusables()
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
        close(true)
        break
      case 'Tab':
        close(false)
        return
      default: {
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
        const ta = typeahead.current
        clearTimeout(ta.timer)
        ta.text += e.key.toLowerCase()
        ta.timer = setTimeout(() => (ta.text = ''), 600)
        const from = ta.text.length > 1 ? i : i + 1
        const order = [...els.slice(from), ...els.slice(0, from)]
        order.find((el) => el.textContent?.trim().toLowerCase().startsWith(ta.text))?.focus()
        return
      }
    }
    e.preventDefault()
  }

  const triggerProps: MenuTriggerProps = {
    ref: triggerRef,
    onClick: () => (open ? close(false) : openMenu()),
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        openMenu()
      }
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? panelId : undefined,
  }

  return (
    <>
      {trigger(triggerProps)}
      {open && container
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="menu"
              aria-label={label}
              className="menu"
              style={style ?? { top: 0, left: 0, visibility: 'hidden' }}
              onKeyDown={onPanelKeyDown}
            >
              {items.map((item) =>
                item.type === 'separator' ? (
                  <div key={item.id} role="separator" className="menu__separator" />
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                    aria-checked={item.checked}
                    aria-disabled={item.disabled || undefined}
                    tabIndex={-1}
                    className={['menu__item', item.danger && 'menu__item--danger'].filter(Boolean).join(' ')}
                    onClick={() => {
                      if (item.disabled) return
                      close(true)
                      item.onSelect()
                    }}
                  >
                    <span className="menu__icon" aria-hidden="true">
                      {item.checked ? <Check size={16} /> : item.icon}
                    </span>
                    <span className="menu__label">{item.label}</span>
                    {item.shortcut ? <span className="menu__shortcut">{item.shortcut}</span> : null}
                  </button>
                ),
              )}
            </div>,
            container,
          )
        : null}
    </>
  )
}
