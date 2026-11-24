/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { THEME_COLOR } from './theme'

// Read from disk: Vitest turns imported CSS into an empty string.
const css = readFileSync(new URL('../../styles/tokens.css', import.meta.url), 'utf8')
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8')

/** `--surface` of the rule whose selector is `selector`. */
function surface(selector: string): string | undefined {
  const start = css.indexOf(selector)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  return /--surface:\s*([^;]+);/.exec(body)?.[1]?.trim()
}

describe('the theme-color metas', () => {
  it('are the top bar surface colours of the two themes (what the tokens say)', () => {
    expect(THEME_COLOR.light).toBe(surface(":root[data-theme='light']"))
    expect(THEME_COLOR.dark).toBe(surface(":root[data-theme='dark']"))
  })

  it('have the same two colours in index.html, as the static metas and in the script that applies a stored choice', () => {
    expect(html).toContain(`name="theme-color" content="${THEME_COLOR.light}" media="(prefers-color-scheme: light)"`)
    expect(html).toContain(`name="theme-color" content="${THEME_COLOR.dark}" media="(prefers-color-scheme: dark)"`)
    expect(html).toContain(`t === 'dark' ? '${THEME_COLOR.dark}' : '${THEME_COLOR.light}'`)
  })
})
