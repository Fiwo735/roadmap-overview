import { CircleHelp, Ellipsis, Moon, Presentation, Redo2, Sun, Undo2 } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { Menu, type MenuEntry } from '../../components/Menu'
import { useHistory } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import { openHelp } from '../help/helpActions'
import { togglePresentation, usePresentationStore } from '../presentation/presentationStore'
import { useEditingLocked } from '../ride/rideStore'
import { chooseTheme } from '../theme/theme'
import { shortcutLabel } from './shortcuts'

/**
 * Phones (below 600 px): the top bar keeps the title, Ride, Image and File and folds the rest — undo and
 * redo, presentation mode, help and the theme — into this menu. Wider screens hide it and show those buttons.
 */
export function TopBarOverflow() {
  const { undo, redo, canUndo, canRedo } = useHistory()
  const locked = useEditingLocked()
  const presenting = usePresentationStore((s) => s.on)
  const theme = useUiStore((s) => s.theme)
  const nextTheme = theme === 'dark' ? 'light' : 'dark'

  const items: MenuEntry[] = [
    ...(presenting
      ? []
      : ([
          { id: 'undo', label: 'Undo', icon: <Undo2 size={16} />, shortcut: shortcutLabel('Z'), disabled: !canUndo || locked, onSelect: undo },
          { id: 'redo', label: 'Redo', icon: <Redo2 size={16} />, shortcut: shortcutLabel('Z', true), disabled: !canRedo || locked, onSelect: redo },
          { type: 'separator', id: 'sep-history' },
        ] satisfies MenuEntry[])),
    { id: 'present', label: presenting ? 'Leave presentation mode' : 'Presentation mode', icon: <Presentation size={16} />, shortcut: 'P', onSelect: togglePresentation },
    { id: 'help', label: 'Help and shortcuts', icon: <CircleHelp size={16} />, shortcut: '?', onSelect: openHelp },
    { type: 'separator', id: 'sep-theme' },
    {
      id: 'theme',
      label: `Switch to ${nextTheme} mode`,
      icon: theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />,
      onSelect: () => chooseTheme(nextTheme),
    },
  ]

  return (
    <div className="topbar__overflow">
      <Menu
        label="More"
        align="end"
        items={items}
        trigger={(props) => <IconButton {...props} label="More" tooltip="More actions" icon={<Ellipsis size={18} />} data-testid="topbar-overflow" />}
      />
    </div>
  )
}
