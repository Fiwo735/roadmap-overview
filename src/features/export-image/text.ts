// Framework-free text helpers for the canvas, which has no layout of its own. `measure` returns the
// width of a string in the font the caller is drawing it in.

export type Measure = (text: string) => number

const ELLIPSIS = '…'

/** `text` cut to fit `maxWidth`, ending in an ellipsis when something was removed. */
export function ellipsize(text: string, maxWidth: number, measure: Measure): string {
  if (measure(text) <= maxWidth) return text
  const chars = [...text]
  let lo = 0
  let hi = chars.length
  // Longest prefix whose width plus the ellipsis still fits (the width only grows with the prefix).
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(chars.slice(0, mid).join('').trimEnd() + ELLIPSIS) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return chars.slice(0, lo).join('').trimEnd() + ELLIPSIS
}

/**
 * Break `text` into lines of at most `maxWidth`, at spaces where possible (a word wider than a line is
 * broken anywhere). With more than `maxLines` lines the rest is dropped and the last line ends in an
 * ellipsis.
 */
export function wrapLines(text: string, maxWidth: number, measure: Measure, maxLines: number): string[] {
  const lines: string[] = []
  const words = text.split(/\s+/).filter(Boolean)
  let current = ''

  for (const word of words) {
    const joined = current ? `${current} ${word}` : word
    if (measure(joined) <= maxWidth) {
      current = joined
      continue
    }
    if (current) lines.push(current)
    current = ''
    // A word that does not fit a line on its own is broken into pieces that do.
    let rest = word
    while (measure(rest) > maxWidth) {
      const chars = [...rest]
      let n = chars.length - 1
      while (n > 1 && measure(chars.slice(0, n).join('')) > maxWidth) n--
      lines.push(chars.slice(0, n).join(''))
      rest = chars.slice(n).join('')
    }
    current = rest
  }
  if (current) lines.push(current)

  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  // Re-flow the cut-off text onto the last kept line so it can be ellipsized as a whole.
  kept[maxLines - 1] = ellipsize(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, maxWidth, measure)
  return kept
}
