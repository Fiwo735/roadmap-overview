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

/**
 * The top bar's `--surface` in each theme: what the browser's address bar (and an installed app's title bar) is tinted with, through
 * `<meta name="theme-color">`. `theme.test.ts` checks the values against `styles/tokens.css`; index.html's inline script has the same two.
 */
export const THEME_COLOR: Record<Theme, string> = { light: '#ffffff', dark: '#161d28' }

/**
 * index.html has one theme-color meta per OS scheme (`media="(prefers-color-scheme: …)"`), which is right while the app follows the OS.
 * Once the user has picked a theme the tint must follow that choice instead (a dark app on a light OS, or the reverse), so every meta gets
 * the chosen theme's colour; with no stored choice each goes back to its own scheme's.
 */
export function syncThemeColor(): void {
  const chosen = readStoredTheme()
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const scheme: Theme = meta.getAttribute('media')?.includes('dark') ? 'dark' : 'light'
    meta.setAttribute('content', THEME_COLOR[chosen ?? scheme])
  }
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

function systemTheme(): Theme {
  return darkQuery().matches ? 'dark' : 'light'
}

/**
 * Resolve the initial theme (stored choice, else the OS preference), mirror the store's theme onto
 * <html data-theme>, and follow OS changes while the user has not chosen explicitly.
 * index.html sets data-theme (and the theme-color metas) early to avoid a flash; this keeps them in sync afterwards.
 */
export function initTheme(): () => void {
  const apply = (theme: Theme) => {
    document.documentElement.dataset.theme = theme
  }
  useUiStore.getState().setTheme(readStoredTheme() ?? systemTheme())
  apply(useUiStore.getState().theme)
  syncThemeColor()

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
  syncThemeColor()
}
