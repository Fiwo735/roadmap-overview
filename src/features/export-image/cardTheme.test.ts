/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CARD_THEME_TOKENS, CARD_THEMES, type CardThemeName } from './cardTheme'

// Read from disk: Vitest turns imported CSS (even `?raw`) into an empty string.
const css = readFileSync(new URL('../../styles/tokens.css', import.meta.url), 'utf8')

/** The declarations of the rule whose selector is `selector`. */
function declarations(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  expect(start, `${selector} in tokens.css`).toBeGreaterThanOrEqual(0)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[name] = value.trim()
  return out
}

describe('card themes', () => {
  const rules: Record<CardThemeName, string> = { light: ":root[data-theme='light']", dark: ":root[data-theme='dark']" }

  for (const name of ['light', 'dark'] as const) {
    it(`the ${name} card colours are the app's ${name} tokens`, () => {
      const tokens = declarations(rules[name])
      for (const [field, token] of Object.entries(CARD_THEME_TOKENS)) {
        expect(CARD_THEMES[name][field as keyof typeof CARD_THEME_TOKENS], `${token} (${name})`).toBe(tokens[token])
      }
    })
  }
})
