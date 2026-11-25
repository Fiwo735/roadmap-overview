import type { Page } from '@playwright/test'
// Loads the typing of `window.__ROADMAP__` (and its ride).
import type {} from '../src/features/ride/rideStore'
import { expect, test } from './fixtures'

const button = (page: Page) => page.getByTestId('shortcuts-button')
const popover = (page: Page) => page.getByTestId('shortcuts-popover')
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Help' })

interface Section {
  id: string
  title: string
  entries: { keys: string[][]; does: string }[]
}

/** `shortcutSections()` as the app itself computes it (the module the page runs, served by the dev server). */
const sectionsOf = (page: Page): Promise<Section[]> =>
  page.evaluate(`import('/src/features/help/shortcutList.ts').then((m) => m.shortcutSections())`) as Promise<Section[]>

/** The rows of one popover (or dialog) table: the keys, in order, and the words. */
const rowsOf = (page: Page, testId: string) =>
  page.getByTestId(testId).locator('tbody tr').evaluateAll((rows) =>
    rows.map((row) => ({
      keys: [...row.querySelectorAll('kbd')].map((k) => k.textContent ?? ''),
      does: row.querySelector('td')?.textContent ?? '',
    })),
  )

/** Move the pointer well away from the button and the popover (which hangs over the right of the map): into the places list. */
const leave = (page: Page) => page.mouse.move(180, 650)

test.describe('the keyboard button in the top bar', () => {
  test('sits next to Help, is named, and a keyboard user sees its tooltip', async ({ page, app }) => {
    await app.goto()
    await expect(button(page)).toBeVisible()
    await expect(button(page)).toHaveAccessibleName('Keyboard shortcuts')
    await expect(button(page)).toHaveAttribute('aria-haspopup', 'dialog')
    await expect(button(page)).toHaveAttribute('aria-expanded', 'false')
    // Right before Help in the bar.
    const [keys, help] = await Promise.all([button(page).boundingBox(), page.getByTestId('help-button').boundingBox()])
    expect(keys!.x + keys!.width).toBeLessThanOrEqual(help!.x + 1)
    expect(help!.x - (keys!.x + keys!.width)).toBeLessThanOrEqual(8)

    // Tab reaches it; the tooltip names it (hovering opens the popover instead, which is titled the same).
    await page.getByTestId('present-toggle').focus()
    await page.keyboard.press('Tab')
    await expect(button(page)).toBeFocused()
    await expect(page.locator('.tooltip')).toHaveText('Keyboard shortcuts')
  })

  test('hovering opens the popover after a short rest, and leaving closes it again', async ({ page, app }) => {
    await app.goto()
    await expect(popover(page)).toBeHidden()
    await button(page).hover()
    await expect(popover(page)).toBeVisible()
    await expect(button(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(popover(page)).toHaveAccessibleName('Keyboard shortcuts')
    await expect(popover(page).getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()
    // The tooltip does not sit on top of it.
    await expect(page.locator('.tooltip')).toHaveCount(0)

    await leave(page)
    await expect(popover(page)).toBeHidden()
    await expect(button(page)).toHaveAttribute('aria-expanded', 'false')
    // Focus was never taken from the page by a hover.
    await expect(button(page)).not.toBeFocused()
  })

  test('a quick pass over the button does not open it', async ({ page, app }) => {
    await app.goto()
    const box = (await button(page).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await leave(page)
    await page.waitForTimeout(600)
    await expect(popover(page)).toBeHidden()
  })

  test('stays open while the pointer is on the popover, and closes when it leaves that', async ({ page, app }) => {
    await app.goto()
    await button(page).hover()
    await expect(popover(page)).toBeVisible()
    const box = (await popover(page).boundingBox())!
    // Over the gap to the popover and onto it.
    await page.mouse.move(box.x + box.width - 20, box.y + 60, { steps: 6 })
    await page.waitForTimeout(500)
    await expect(popover(page)).toBeVisible()
    await leave(page)
    await expect(popover(page)).toBeHidden()
  })

  test('its rows are the Help dialog’s: every section and shortcut of shortcutSections()', async ({ page, app }) => {
    await app.goto()
    const sections = await sectionsOf(page)
    expect(sections.length).toBeGreaterThan(3)
    await button(page).click()
    await expect(popover(page)).toBeVisible()
    for (const section of sections) {
      await expect(page.getByTestId(`shortcuts-keys-${section.id}`).locator('caption')).toHaveText(section.title)
      const rows = await rowsOf(page, `shortcuts-keys-${section.id}`)
      expect(rows).toEqual(section.entries.map((e) => ({ keys: e.keys.flat(), does: e.does })))
    }
    // The same text as the dialog's tables.
    const inPopover = await Promise.all(sections.map((s) => rowsOf(page, `shortcuts-keys-${s.id}`)))
    await page.keyboard.press('Escape')
    await page.keyboard.press('?')
    await expect(dialog(page)).toBeVisible()
    const inDialog = await Promise.all(sections.map((s) => rowsOf(page, `help-keys-${s.id}`)))
    expect(inPopover).toEqual(inDialog)
  })

  test('a click opens it and keeps it open when the pointer moves away; Escape closes it with the focus back on the button', async ({ page, app }) => {
    await app.goto()
    await button(page).click()
    await expect(popover(page)).toBeVisible()
    // The focus moves into it, so the keys scroll it.
    await expect(popover(page)).toBeFocused()
    await leave(page)
    await page.waitForTimeout(500)
    await expect(popover(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(popover(page)).toBeHidden()
    await expect(button(page)).toBeFocused()
    await expect(button(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('Enter and Space on the focused button open it; Escape closes it and returns the focus', async ({ page, app }) => {
    await app.goto()
    for (const key of ['Enter', ' ']) {
      await button(page).focus()
      await page.keyboard.press(key)
      await expect(popover(page)).toBeVisible()
      await expect(popover(page)).toBeFocused()
      await expect(button(page)).toHaveAttribute('aria-controls', (await popover(page).getAttribute('id'))!)
      await page.keyboard.press('Escape')
      await expect(popover(page)).toBeHidden()
      await expect(button(page)).toBeFocused()
    }
    // Pressing the button again closes an opened popover.
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeVisible()
    await button(page).click()
    await expect(popover(page)).toBeHidden()
  })

  test('Tab leaves it for the button, a click elsewhere closes it, and so does opening the Help', async ({ page, app }) => {
    await app.goto()
    await button(page).focus()
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(popover(page)).toBeHidden()
    await expect(button(page)).toBeFocused()

    await button(page).click()
    await expect(popover(page)).toBeVisible()
    await page.getByTestId('map-area').click({ position: { x: 40, y: 700 } })
    await expect(popover(page)).toBeHidden()

    await button(page).click()
    await expect(popover(page)).toBeVisible()
    await page.keyboard.press('?')
    await expect(dialog(page)).toBeVisible()
    await expect(popover(page)).toBeHidden()
  })

  test('hovering and then clicking keeps it open (a click is a choice, not a toggle off)', async ({ page, app }) => {
    await app.goto()
    await button(page).hover()
    await expect(popover(page)).toBeVisible()
    await button(page).click()
    await leave(page)
    await page.waitForTimeout(500)
    await expect(popover(page)).toBeVisible()
    await button(page).click()
    await expect(popover(page)).toBeHidden()
  })

  test('Escape closes a hovered popover and nothing else', async ({ page, app }) => {
    await app.goto()
    await button(page).hover()
    await expect(popover(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popover(page)).toBeHidden()
  })

  test('in presentation mode it stays, like Help, and Escape closes it before it leaves the mode', async ({ page, app }) => {
    await app.goto()
    await page.getByTestId('present-toggle').click()
    await expect(page.locator('.app')).toHaveAttribute('data-presenting', 'true')
    await expect(button(page)).toBeVisible()
    await expect(page.getByTestId('help-button')).toBeVisible()
    await button(page).click()
    await expect(popover(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popover(page)).toBeHidden()
    await expect(page.locator('.app')).toHaveAttribute('data-presenting', 'true')
    await page.keyboard.press('Escape')
    await expect(page.locator('.app')).not.toHaveAttribute('data-presenting', 'true')
  })

  test('during a ride Escape closes the popover first, and its keys do not drive the ride', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Hamburg', 'Rotterdam')
    await expect(page.getByTestId('leg-connector').first()).toHaveAttribute('data-status', 'ok')
    await page.getByTestId('ride-button').click()
    await expect(page.getByTestId('ride-hud')).toBeVisible()
    await page.evaluate(() => window.__ROADMAP__!.ride!.pause())
    const state = () => page.evaluate(() => window.__ROADMAP__!.ride!.store.getState().playing)

    await button(page).click()
    await expect(popover(page)).toBeFocused()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    expect(await state()).toBe(false)
    await page.keyboard.press('Escape')
    await expect(popover(page)).toBeHidden()
    await expect(page.getByTestId('ride-hud')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('ride-hud')).toBeHidden()
  })

  test('during a ride a hovered popover takes the Escape too, though the ride’s keys are older than it', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Hamburg', 'Rotterdam')
    await expect(page.getByTestId('leg-connector').first()).toHaveAttribute('data-status', 'ok')
    await page.getByTestId('ride-button').click()
    await expect(page.getByTestId('ride-hud')).toBeVisible()
    await button(page).hover()
    await expect(popover(page)).toBeVisible()
    // The focus is still in the ride's controls.
    await page.keyboard.press('Escape')
    await expect(popover(page)).toBeHidden()
    await expect(page.getByTestId('ride-hud')).toBeVisible()
  })

  test('with the focus in it, `?` opens the Help from the button, so the focus is back on the button when the Help closes', async ({ page, app }) => {
    await app.goto()
    await button(page).click()
    await expect(popover(page)).toBeFocused()
    await page.keyboard.press('?')
    await expect(dialog(page)).toBeVisible()
    await expect(popover(page)).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await expect(button(page)).toBeFocused()
    // Not on the page behind: Enter opens the popover again.
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeVisible()
  })

  test('with the focus in it, the keys that work anywhere work, and the popover makes way for them with the focus on the button', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Hamburg', 'Rotterdam')
    // Registered first: Playwright turns the file chooser interception on asynchronously (see io.spec.ts).
    const choosing = page.waitForEvent('filechooser')
    const opened = async () => {
      await button(page).click()
      await expect(popover(page)).toBeFocused()
    }
    const closed = async () => {
      await expect(popover(page)).toBeHidden()
      await expect(button(page)).toBeFocused()
    }

    // P: presentation mode.
    await opened()
    await page.keyboard.press('p')
    await expect(page.locator('.app')).toHaveAttribute('data-presenting', 'true')
    await closed()
    await page.keyboard.press('Escape')
    await expect(page.locator('.app')).not.toHaveAttribute('data-presenting', 'true')

    // Ctrl+Z and Ctrl+Shift+Z: undo and redo.
    const before = (await app.trip()).places.length
    await page.evaluate(() => window.__ROADMAP__!.trip.getState().removePlace(window.__ROADMAP__!.trip.getState().trip.places[0].id))
    expect((await app.trip()).places).toHaveLength(before - 1)
    await opened()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await app.trip()).places.length).toBe(before)
    await closed()
    await opened()
    await page.keyboard.press('Control+Shift+z')
    await expect.poll(async () => (await app.trip()).places.length).toBe(before - 1)
    await closed()

    // Ctrl+S saves a file, Ctrl+O asks for one.
    await opened()
    const downloading = page.waitForEvent('download')
    await page.keyboard.press('Control+s')
    expect((await downloading).suggestedFilename()).toMatch(/\.trip\.json$/)
    await closed()
    await opened()
    await page.keyboard.press('Control+o')
    expect(await choosing).toBeTruthy()
    await closed()
  })

  test('with the focus in it, the keys that scroll it leave it open', async ({ page, app }) => {
    await page.setViewportSize({ width: 1280, height: 420 })
    await app.goto()
    await button(page).click()
    await expect(popover(page)).toBeFocused()
    const top = () => popover(page).evaluate((el) => el.scrollTop)
    // Keyboard scrolling is animated: read the position once it has come to rest, so the next key starts from a still popover.
    const settled = async () => {
      let last = await top()
      for (;;) {
        await page.waitForTimeout(120)
        const now = await top()
        if (now === last) return now
        last = now
      }
    }
    const bottom = () => popover(page).evaluate((el) => el.scrollHeight - el.clientHeight)
    expect(await top()).toBe(0)
    expect(await bottom()).toBeGreaterThan(0)
    // Each key scrolls (End and Home to the very end and start: a PageDown or PageUp may already have got there).
    for (const key of ['ArrowDown', 'PageDown']) {
      const before = await settled()
      await page.keyboard.press(key)
      await expect.poll(top, { message: key }).toBeGreaterThan(before)
      await expect(popover(page)).toBeVisible()
    }
    await page.keyboard.press('End')
    await expect.poll(top, { message: 'End' }).toBe(await bottom())
    await expect(popover(page)).toBeVisible()
    for (const key of ['ArrowUp', 'PageUp']) {
      const before = await settled()
      await page.keyboard.press(key)
      await expect.poll(top, { message: key }).toBeLessThan(before)
      await expect(popover(page)).toBeVisible()
    }
    await page.keyboard.press('Home')
    await expect.poll(top, { message: 'Home' }).toBe(0)
    await expect(popover(page)).toBeVisible()
    await page.keyboard.press('Space')
    await expect.poll(top).toBeGreaterThan(0)
    await expect(popover(page)).toBeVisible()
    await expect(popover(page)).toBeFocused()
    // Keys with no job here do not close it either.
    await page.keyboard.press('x')
    await expect(popover(page)).toBeVisible()
  })

  test('hover-opened, then Tab: the focus moves on as usual (it is no trap), and Escape closes the popover without taking the focus', async ({ page, app }) => {
    await app.goto()
    await button(page).focus()
    // The pointer arrives while the button has the focus.
    await button(page).hover()
    await expect(popover(page)).toBeVisible()
    await expect(button(page)).toBeFocused()

    await page.keyboard.press('Tab')
    await expect(page.getByTestId('help-button')).toBeFocused()
    // Still hovered, so still there; nothing inside it takes the focus.
    await expect(popover(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popover(page)).toBeHidden()
    await expect(page.getByTestId('help-button')).toBeFocused()

    // Away and back: it opens again.
    await leave(page)
    await button(page).hover()
    await expect(popover(page)).toBeVisible()
    await leave(page)
    await expect(popover(page)).toBeHidden()
  })

  test('is a scrollable panel that fits a short window, with every row reachable', async ({ page, app }) => {
    await page.setViewportSize({ width: 1280, height: 420 })
    await app.goto()
    await button(page).click()
    await expect(popover(page)).toBeVisible()
    const box = (await popover(page).boundingBox())!
    expect(box.y).toBeGreaterThan(40)
    expect(box.y + box.height).toBeLessThanOrEqual(420)
    const scroll = await popover(page).evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: getComputedStyle(el).overflowY }))
    expect(scroll.overflowY).toBe('auto')
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight)

    // The last row is out of sight until it is scrolled to, and the keys scroll it.
    const sections = await sectionsOf(page)
    const last = sections[sections.length - 1].entries.at(-1)!.does
    const lastRow = popover(page).getByRole('cell', { name: last, exact: true })
    await expect(lastRow).not.toBeInViewport()
    await page.keyboard.press('End')
    await expect(lastRow).toBeInViewport()
  })

  test('fits the narrowest window that has the button', async ({ page, app }) => {
    await page.setViewportSize({ width: 768, height: 800 })
    await app.goto()
    await button(page).click()
    const box = (await popover(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(768)
    expect(box.y + box.height).toBeLessThanOrEqual(800)
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`looks right in the ${scheme} theme`, async ({ page, app }, testInfo) => {
      await app.goto()
      if (scheme === 'dark') await page.getByTestId('theme-toggle').click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
      await button(page).click()
      await expect(popover(page)).toBeVisible()
      await page.waitForTimeout(250)
      // What the theme's tokens come to in this page (resolved through a probe element, so they are compared as colours, not as hex text).
      const look = await popover(page).evaluate((el) => {
        const resolve = (property: 'backgroundColor' | 'color' | 'borderTopColor', token: string) => {
          const probe = document.createElement('div')
          if (property === 'backgroundColor') probe.style.background = `var(${token})`
          else if (property === 'color') probe.style.color = `var(${token})`
          else probe.style.border = `1px solid var(${token})`
          document.body.append(probe)
          const value = getComputedStyle(probe)[property]
          probe.remove()
          return value
        }
        const style = getComputedStyle(el)
        const kbd = getComputedStyle(el.querySelector('kbd')!)
        return {
          background: style.backgroundColor,
          color: style.color,
          border: style.borderTopColor,
          kbd: kbd.backgroundColor,
          surface: resolve('backgroundColor', '--surface'),
          text: resolve('color', '--text'),
          line: resolve('borderTopColor', '--border'),
          surface2: resolve('backgroundColor', '--surface-2'),
        }
      })
      expect(look.background).toBe(look.surface)
      expect(look.color).toBe(look.text)
      expect(look.border).toBe(look.line)
      expect(look.kbd).toBe(look.surface2)
      // And a token's value is this theme's: the text is the darker colour of the two in the light theme, the lighter in the dark one.
      const brightness = (rgb: string) => rgb.match(/\d+/g)!.slice(0, 3).reduce((sum, n) => sum + Number(n), 0)
      if (scheme === 'dark') expect(brightness(look.text)).toBeGreaterThan(brightness(look.surface))
      else expect(brightness(look.text)).toBeLessThan(brightness(look.surface))
      await testInfo.attach(`shortcuts-popover-${scheme}`, { body: await page.screenshot(), contentType: 'image/png' })
    })
  }
})

test.describe('where it is not offered', () => {
  test('a phone’s top bar has no keyboard button (Help and shortcuts is in its menu)', async ({ page, app }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await app.goto()
    await expect(button(page)).toBeHidden()
    await page.getByTestId('topbar-overflow').click()
    await expect(page.getByRole('menuitem', { name: 'Help and shortcuts' })).toBeVisible()
  })

  test('it shows from 768 px wide, where the title still has room, and folds away below', async ({ page, app }) => {
    await page.setViewportSize({ width: 768, height: 800 })
    await app.goto()
    await expect(button(page)).toBeVisible()
    expect((await page.getByTestId('trip-title').boundingBox())!.width).toBeGreaterThan(120)
    await page.setViewportSize({ width: 767, height: 800 })
    await expect(button(page)).toBeHidden()
    // Help stays: on a tablet-width bar the dialog has the same list.
    await expect(page.getByTestId('help-button')).toBeVisible()
  })

  test.describe('a touch-only device', () => {
    test.use({ hasTouch: true })

    test('has no keyboard button, whatever the width, and Help is still there', async ({ page, app }) => {
      await app.goto()
      expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true)
      await expect(page.getByTestId('help-button')).toBeVisible()
      await expect(button(page)).toHaveCount(0)
      await page.setViewportSize({ width: 820, height: 1000 })
      await expect(button(page)).toHaveCount(0)
    })
  })
})
