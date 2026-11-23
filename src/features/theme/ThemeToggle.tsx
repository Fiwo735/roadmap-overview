import { Moon, Sun } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { useUiStore } from '../../store/uiStore'
import { chooseTheme } from './theme'

export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme)
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <IconButton
      label={`Switch to ${next} mode`}
      icon={theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      onClick={() => chooseTheme(next)}
      data-testid="theme-toggle"
    />
  )
}
