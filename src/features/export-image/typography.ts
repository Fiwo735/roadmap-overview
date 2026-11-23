// Framework-free: how the image's text is set.

/** The app's font stack (`--font-sans` in styles/tokens.css). */
export const FONT_FAMILY = '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/** A canvas font string: `font(600, 12)` is 12 px at weight 600. */
export const font = (weight: number, size: number) => `${weight} ${size}px ${FONT_FAMILY}`

/** Baseline of text of `size` px centred in a line box of `lineHeight` that starts at `top`. */
export const baselineIn = (top: number, lineHeight: number, size: number) => top + lineHeight / 2 + size * 0.36

/** Width of a string in a font, in CSS pixels. */
export type MeasureFont = (font: string, text: string) => number
