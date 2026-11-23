import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import type { TripFile } from '../src/types/trip'
import { expect, STORAGE_KEYS, test } from './fixtures'

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Help' })
const hint = (page: Page) => page.getByTestId('welcome-hint')
const sampleFile = (): TripFile => JSON.parse(readFileSync('public/samples/hamburg-fjords.trip.json', 'utf8')) as TripFile

test.describe('help dialog', () => {
  test('the ? button opens it, with the how-tos and the keyboard shortcuts, and Escape closes it', async ({ page, app }) => {
    await app.goto()
    await page.getByTestId('help-button').click()
    await expect(dialog(page)).toBeVisible()
    expect((await app.ui()).openDialogId).toBe('help')

    for (const topic of ['Add and arrange places', 'Shape the route', 'Show it', 'Save and share']) {
      await expect(dialog(page).getByRole('heading', { name: topic })).toBeVisible()
    }
    // The topics the spec calls for are all mentioned.
    const text = (await dialog(page).textContent()) ?? ''
    for (const word of ['right-click', 'reorder', 'day', 'via point', 'double-click', 'ferry', 'Follow roads', 'Ride', 'Image', 'share link', 'Presentation mode']) {
      expect(text.toLowerCase()).toContain(word.toLowerCase())
    }

    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    expect((await app.ui()).openDialogId).toBeNull()
  })

  test('the ? key opens it, unless a field is being typed in', async ({ page, app }) => {
    await app.goto()
    await page.keyboard.press('?')
    await expect(dialog(page)).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(dialog(page)).toBeHidden()

    // In the search box a ? is a character.
    const search = page.getByRole('combobox', { name: 'Add a place' })
    await search.click()
    await page.keyboard.type('Lyon?')
    await expect(search).toHaveValue('Lyon?')
    await expect(dialog(page)).toBeHidden()
    // Nor in the trip title.
    await page.getByTestId('trip-title').click()
    await page.keyboard.type('?')
    await expect(dialog(page)).toBeHidden()
  })

  test('the shortcut table lists every key the app has, and they work', async ({ page, app }) => {
    await app.goto()
    await page.keyboard.press('?')
    const general = page.getByTestId('help-keys-general')
    for (const does of ['Open this help', 'Presentation mode on or off', 'Undo', 'Redo', 'Save the trip as a JSON file', 'Open a trip file']) {
      await expect(general.getByRole('cell', { name: does })).toBeVisible()
    }
    await expect(page.getByTestId('help-keys-places')).toBeVisible()
    await expect(page.getByTestId('help-keys-map')).toBeVisible()
    await expect(page.getByTestId('help-keys-ride').getByRole('cell', { name: 'Play or pause' })).toBeVisible()
    await expect(page.getByTestId('help-keys-menus')).toBeVisible()
    // Keys are drawn as keys.
    await expect(general.locator('kbd', { hasText: '?' }).first()).toBeVisible()
    await expect(general.locator('kbd', { hasText: 'P' }).first()).toBeVisible()

    // While a dialog is open the trip behind it does not change: Ctrl+Z is ignored, but Escape closes it.
    await page.keyboard.press('Escape')
    await app.addPlaces('Lyon')
    await page.keyboard.press('Control+z')
    expect((await app.trip()).places).toHaveLength(0)
  })

  test('on a phone the dialog fits and scrolls, and the overflow menu opens it', async ({ page, app }) => {
    await page.setViewportSize({ width: 390, height: 700 })
    await app.goto()
    await page.getByTestId('topbar-overflow').click()
    await page.getByRole('menuitem', { name: 'Help and shortcuts' }).click()
    await expect(dialog(page)).toBeVisible()
    const box = (await dialog(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(box.y + box.height).toBeLessThanOrEqual(700)
    // The last section is reachable by scrolling the body.
    await dialog(page).getByTestId('help-keys-menus').scrollIntoViewIfNeeded()
    await expect(dialog(page).getByTestId('help-keys-menus')).toBeInViewport()
  })

  test('in a dark theme the dialog uses the theme colours', async ({ page, app }) => {
    await app.goto()
    await page.getByTestId('theme-toggle').click()
    await page.keyboard.press('?')
    const colours = await dialog(page).evaluate((el) => {
      const style = getComputedStyle(el)
      return { background: style.backgroundColor, color: style.color }
    })
    expect(colours.background).not.toBe('rgb(255, 255, 255)')
    expect(colours.color).not.toBe('rgb(24, 33, 47)')
  })
})

test.describe('first-visit hint', () => {
  test.use({ welcomeHint: true })

  test('shows on an empty trip, is dismissed for good and stays away after a reload', async ({ page, app }) => {
    await app.goto()
    await expect(hint(page)).toBeVisible()
    await expect(hint(page)).toContainText('Plan your trip on the map')
    await page.getByTestId('welcome-dismiss').click()
    await expect(hint(page)).toBeHidden()
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.welcomeSeen)).toBe('1')
    await page.reload()
    await app.ready()
    await expect(hint(page)).toBeHidden()
  })

  test('points at search, the sample trip and Help', async ({ page, app }) => {
    await app.goto()
    await hint(page).getByRole('button', { name: 'Add a place' }).click()
    await expect(page.getByRole('combobox', { name: 'Add a place' })).toBeFocused()

    await hint(page).getByRole('button', { name: 'How it works' }).click()
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByTestId('welcome-sample').click()
    await expect.poll(async () => (await app.trip()).places.length).toBe(12)
    await expect(hint(page)).toBeHidden()
    // Opening the sample counts as having started: the hint never comes back, not even for an empty trip.
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.welcomeSeen)).toBe('1')
    await app.setTrip({ ...(await app.trip()), places: [], legs: [] })
    await expect(hint(page)).toBeHidden()
  })

  test('never shows once a trip has places, and remembers that', async ({ page, app }) => {
    await app.seedSavedTrip(sampleFile())
    await app.goto()
    await expect(hint(page)).toBeHidden()
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.welcomeSeen)).toBe('1')
  })

  test('is not shown in presentation mode', async ({ page, app }) => {
    await app.goto('/?present')
    await expect(hint(page)).toBeHidden()
  })

  test('on a phone it opens the places slide-over to add a place', async ({ page, app }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await app.goto()
    const box = (await hint(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await hint(page).getByRole('button', { name: 'Add a place' }).click()
    await expect(page.getByTestId('sidebar')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Add a place' })).toBeFocused()
  })
})
