import type { Locator, Page } from '@playwright/test'
import { expect, test, type App } from './fixtures'

const card = (page: Page) => page.getByTestId('trip-card')
const pill = (page: Page) => page.getByTestId('trip-pill')
const hud = (page: Page) => page.getByTestId('ride-hud')

type Box = { x: number; y: number; width: number; height: number }
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const box = async (locator: Locator): Promise<Box> => (await locator.boundingBox())!

async function openTrip(page: Page, app: App) {
  await app.goto()
  await app.addPlaces('Lyon', 'Annecy', 'Zurich')
  for (const i of [0, 1]) await expect(page.getByTestId('leg-connector').nth(i)).toHaveAttribute('data-status', 'ok')
}

/** The title card and the ride controls must never sit on top of each other: on a map too narrow or too short for both the card folds into its pill. */
test.describe('the title card while a ride runs', () => {
  test('stays as it is on a roomy window', async ({ page, app }) => {
    await openTrip(page, app)
    await page.getByTestId('ride-button').click()
    await expect(hud(page)).toBeVisible()
    await expect(card(page)).toBeVisible()
    await expect(pill(page)).toHaveCount(0)
    expect(overlap(await box(card(page)), await box(hud(page)))).toBe(false)
  })

  test('folds into its pill on a map that is narrow (a window under about 1100 px) and comes back after the ride', async ({ page, app }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await openTrip(page, app)
    await expect(card(page)).toBeVisible()
    await page.getByTestId('ride-button').click()
    await expect(hud(page)).toBeVisible()
    await expect(pill(page)).toBeVisible()
    await expect(card(page)).toHaveCount(0)
    expect(overlap(await box(pill(page)), await box(hud(page)))).toBe(false)

    await page.getByTestId('ride-close').click()
    await expect(card(page)).toBeVisible()
    await expect(pill(page)).toHaveCount(0)
  })

  test('folds on a short map even when it is wide, and unfolds when the window grows during the ride', async ({ page, app }) => {
    await page.setViewportSize({ width: 1440, height: 480 })
    await openTrip(page, app)
    await page.getByTestId('ride-button').click()
    await expect(hud(page)).toBeVisible()
    await expect(pill(page)).toBeVisible()
    await expect(card(page)).toHaveCount(0)

    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(card(page)).toBeVisible()
    expect(overlap(await box(card(page)), await box(hud(page)))).toBe(false)
  })

  test('never overlaps the controls at any of a range of window sizes', async ({ page, app }) => {
    await openTrip(page, app)
    await page.getByTestId('ride-button').click()
    await expect(hud(page)).toBeVisible()
    for (const [width, height] of [
      [768, 600],
      [820, 1180],
      [1024, 600],
      [1100, 700],
      [1180, 620],
      [1280, 480],
      [1366, 640],
      [1440, 520],
    ]) {
      await page.setViewportSize({ width, height })
      // The card or its pill, whichever the window asks for, settles within a frame or two.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const shown = document.querySelector('[data-testid="trip-card"]') ?? document.querySelector('[data-testid="trip-pill"]')
            const hud = document.querySelector('.ride-hud')
            if (!shown || !hud) return null
            const [a, b] = [shown.getBoundingClientRect(), hud.getBoundingClientRect()]
            return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
          }),
        )
        .toBe(false)
    }
  })

  test('the user’s own folding is left alone', async ({ page, app }) => {
    await openTrip(page, app)
    await page.getByTestId('card-collapse').click()
    await expect(pill(page)).toBeVisible()
    await page.getByTestId('ride-button').click()
    await expect(hud(page)).toBeVisible()
    await page.getByTestId('ride-close').click()
    await expect(pill(page)).toBeVisible()
    await expect(card(page)).toHaveCount(0)
  })
})
