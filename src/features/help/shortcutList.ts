import { shortcutLabel } from '../layout/shortcuts'

/** One row of the Help dialog's shortcut table: the key combinations (alternatives) and what they do. */
export interface ShortcutEntry {
  /** Alternative ways to do it, each a list of keys pressed together. */
  keys: string[][]
  does: string
}

export interface ShortcutSection {
  id: string
  title: string
  entries: ShortcutEntry[]
}

/**
 * Every keyboard shortcut the app has, written down once for the Help dialog. When a feature adds a key,
 * add it here too (`help.spec.ts` checks the table is on screen, and the sections mirror the code that
 * handles the keys: `layout/shortcuts.ts`, `io/fileShortcuts.ts`, `presentation/`, `ride/RideHud.tsx`,
 * `places/`, `routing/`, `components/Menu.tsx`).
 */
export function shortcutSections(): ShortcutSection[] {
  const keys = (key: string, shift = false) => shortcutLabel(key, shift).split('+')
  return [
    {
      id: 'general',
      title: 'Anywhere',
      entries: [
        { keys: [['?']], does: 'Open the help' },
        { keys: [['P']], does: 'Presentation mode on or off' },
        { keys: [keys('Z')], does: 'Undo' },
        { keys: [keys('Z', true), keys('Y')], does: 'Redo' },
        { keys: [keys('S')], does: 'Save the trip as a JSON file' },
        { keys: [keys('O')], does: 'Open a trip file' },
        { keys: [['Esc']], does: 'Close a menu, dialog or editor; leave presentation mode; close the ride' },
      ],
    },
    {
      id: 'places',
      title: 'Places list',
      entries: [
        { keys: [['Enter']], does: 'Search (in a search box), or save what you typed (name, day)' },
        { keys: [['↑'], ['↓']], does: 'Pick a search result; in the day field: one day earlier or later' },
        { keys: [['Esc']], does: 'Undo what you typed in a field and leave it; close the search' },
        { keys: [['Space']], does: 'On the grip of a row: pick the place up, then drop it' },
        { keys: [['↑'], ['↓']], does: 'While a place is picked up: move it up or down' },
        { keys: [['Esc']], does: 'While a place is picked up: put it back' },
      ],
    },
    {
      id: 'map',
      title: 'Map and routes',
      entries: [
        { keys: [['Delete'], ['Backspace']], does: 'On a focused route handle: remove it' },
        { keys: [['Esc']], does: 'While dragging a route line: cancel the reshape' },
        { keys: [['←'], ['↑'], ['→'], ['↓']], does: 'Pan the map (when the map has the focus)' },
        { keys: [['+'], ['-']], does: 'Zoom the map in or out (when the map has the focus)' },
        { keys: [['Enter']], does: 'On a focused marker: open the place card (the same as clicking it)' },
        { keys: [['Esc']], does: 'Close the photo viewer, then the place card' },
        { keys: [['←'], ['→']], does: 'In the photo viewer: previous or next photo' },
        { keys: [['Tab']], does: 'Reach every marker, route handle and button' },
      ],
    },
    {
      id: 'ride',
      title: 'Ride',
      entries: [
        { keys: [['Space']], does: 'Play or pause' },
        { keys: [['←'], ['→']], does: 'Previous or next day' },
        { keys: [['Esc']], does: 'Close the ride' },
      ],
    },
    {
      id: 'menus',
      title: 'Menus and option groups',
      entries: [
        { keys: [['↑'], ['↓']], does: 'Move between items' },
        { keys: [['Home'], ['End']], does: 'First or last item' },
        { keys: [['Enter'], ['Space']], does: 'Choose the item' },
        { keys: [['a–z']], does: 'Jump to the item that starts with the letters you type (menus)' },
      ],
    },
  ]
}

/**
 * Is this key press one of the "Anywhere" shortcuts that act whatever has the focus: `?`, `P`, and Ctrl/⌘ with Z, Y, S or O?
 * (Esc is the other, but every popup and editor claims it for itself first.) The keyboard popover uses it to make way for them.
 */
export function isAnywhereShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  if (e.altKey) return false
  const key = e.key.toLowerCase()
  if (e.ctrlKey || e.metaKey) return ['z', 'y', 's', 'o'].includes(key)
  return key === '?' || key === 'p'
}
