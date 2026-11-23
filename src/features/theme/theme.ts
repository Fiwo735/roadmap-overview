import { useUiStore, type Theme } from '../../store/uiStore'

export const THEME_KEY = 'roadmap-overview:theme'

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

function systemTheme(): Theme {
  return darkQuery().matches ? 'dark' : 'light'
}

/**
 * Resolve the initial theme (stored choice, else the OS preference), mirror the store's theme onto
 * <html data-theme>, and follow OS changes while the user has not chosen explicitly.
 * index.html sets data-theme early to avoid a flash; this keeps it in sync afterwards.
 */
export function initTheme(): () => void {
  const apply = (theme: Theme) => {
    document.documentElement.dataset.theme = theme
  }
  useUiStore.getState().setTheme(readStoredTheme() ?? systemTheme())
  apply(useUiStore.getState().theme)

  const unsub = useUiStore.subscribe((s, prev) => {
    if (s.theme !== prev.theme) apply(s.theme)
  })
  const mq = darkQuery()
  const onSystemChange = () => {
    if (readStoredTheme() === null) useUiStore.getState().setTheme(systemTheme())
  }
  mq.addEventListener('change', onSystemChange)
  return () => {
    unsub()
    mq.removeEventListener('change', onSystemChange)
  }
}

/** The user picked a theme: apply it and remember the explicit choice. */
export function chooseTheme(theme: Theme): void {
  useUiStore.getState().setTheme(theme)
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // The choice still applies for this session.
  }
}
