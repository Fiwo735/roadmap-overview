// Framework-free: the colours of the card, legend and attribution drawn on the image.

export type CardThemeName = 'light' | 'dark'

/**
 * The tokens of `styles/tokens.css` that the card uses, for both themes. A canvas cannot read the
 * stylesheet's variables for a theme that is not the one applied to <html> (the card style is
 * chosen independently of the app's), so they are copied here; `cardTheme.test.ts` fails when
 * they drift apart.
 */
export interface CardTheme {
  /** `--surface`: the card's background. */
  surface: string
  /** `--surface-2`: the statistics tiles. */
  surface2: string
  /** `--surface-3`: the flags' placeholder. */
  surface3: string
  border: string
  borderStrong: string
  text: string
  textMuted: string
  textFaint: string
  /** The cast shadow (no token: `--shadow-md` is a CSS box-shadow). */
  shadow: string
}

export const CARD_THEMES: Record<CardThemeName, CardTheme> = {
  light: {
    surface: '#ffffff',
    surface2: '#f3f5f8',
    surface3: '#e8ecf2',
    border: '#e1e5eb',
    borderStrong: '#ccd3dd',
    text: '#18212f',
    textMuted: '#5b6678',
    textFaint: '#8893a4',
    shadow: 'rgba(16, 24, 40, 0.22)',
  },
  dark: {
    surface: '#161d28',
    surface2: '#1e2734',
    surface3: '#283344',
    border: '#2a3546',
    borderStrong: '#3b475b',
    text: '#e8edf4',
    textMuted: '#9ba7b9',
    textFaint: '#717e93',
    shadow: 'rgba(0, 0, 0, 0.55)',
  },
}

/** The `--token` name each field copies (the shadow has none). */
export const CARD_THEME_TOKENS: Record<Exclude<keyof CardTheme, 'shadow'>, string> = {
  surface: '--surface',
  surface2: '--surface-2',
  surface3: '--surface-3',
  border: '--border',
  borderStrong: '--border-strong',
  text: '--text',
  textMuted: '--text-muted',
  textFaint: '--text-faint',
}
