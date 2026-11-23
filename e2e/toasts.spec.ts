import type { Locator, Page } from '@playwright/test'
import { expect, test, type App } from './fixtures'

const toasts = (page: Page) => page.getByTestId('toast')

type Box = { x: number; y: number; width: number; height: number }
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const box = async (locator: Locator): Promise<Box> => (await locator.boundingBox())!

/** Ctrl+S on a trip without places answers with a toast (and downloads nothing). */
async function showToast(page: Page) {
  await page.keyboard.press('Control+s')
  await expect(toasts(page)).toHaveCount(1)
}

async function routedTrip(page: Page, app: App) {
  await app.goto()
  await app.addPlaces('Lyon', 'Annecy', 'Zurich')
  for (const i of [0, 1]) await expect(page.getByTestId('leg-connector').nth(i)).toHaveAttribute('data-status', 'ok')
  await page.getByTestId('fit-trip').click()
  await app.settle()
}

test.describe('toast placement', () => {
  test('on a wide screen toasts sit at the bottom of the map, clear of the title card, the map tools and the sidebar', async ({ page, app }) => {
    await app.goto()
    await showToast(page)
    const toast = await box(toasts(page))
    const map = await box(page.getByTestId('map-area'))
    expect(toast.x).toBeGreaterThanOrEqual(map.x)
    expect(toast.x + toast.width).toBeLessThanOrEqual(map.x + map.width)
    expect(toast.y + toast.height).toBeLessThanOrEqual(map.y + map.height)
    // In the lower half, below the card.
    expect(toast.y).toBeGreaterThan(map.y + map.height / 2)
    expect(overlap(toast, await box(page.getByTestId('trip-card')))).toBe(false)
    expect(overlap(toast, await box(page.getByTestId('map-tools')))).toBe(false)
    expect(overlap(toast, await box(page.getByTestId('sidebar')))).toBe(false)
    // The top bar's title is not covered either.
    expect(overlap(toast, await box(page.getByTestId('trip-title')))).toBe(false)
  })

  test('toasts stack upwards from the bottom and can still be dismissed', async ({ page, app }) => {
    await app.goto()
    await page.keyboard.press('Control+s')
    await page.keyboard.press('Control+s')
    await expect(toasts(page)).toHaveCount(2)
    const [a, b] = [await box(toasts(page).first()), await box(toasts(page).last())]
    expect(overlap(a, b)).toBe(false)
    // The newest is nearest the bottom edge.
    expect(b.y).toBeGreaterThan(a.y)
    await toasts(page).first().getByRole('button', { name: 'Dismiss' }).click()
    await expect(toasts(page)).toHaveCount(1)
  })

  test('clicks pass through the gaps around a toast to the map', async ({ page, app }) => {
    await app.goto()
    await showToast(page)
    const t = await box(toasts(page))
    // Right above the toast is the map: a right-click there opens the map menu.
    await page.mouse.click(t.x + t.width / 2, t.y - 20, { button: 'right' })
    await expect(page.getByRole('menu', { name: 'Map actions' })).toBeVisible()
  })

  test('during a ride they sit above the ride controls', async ({ page, app }) => {
    await routedTrip(page, app)
    await page.getByTestId('ride-button').click()
    await expect(page.getByTestId('ride-hud')).toBeVisible()
    await page.keyboard.press('Control+s')
    await expect(toasts(page).last()).toBeVisible()
    const hud = await box(page.getByTestId('ride-hud'))
    for (const toast of await toasts(page).all()) {
      const t = await box(toast)
      expect(overlap(t, hud)).toBe(false)
      expect(t.y + t.height).toBeLessThanOrEqual(hud.y)
      expect(overlap(t, await box(page.getByTestId('trip-card')))).toBe(false)
    }
  })

  test('on a phone they stay at the bottom, above the ride controls during a ride', async ({ page, app }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await routedTrip(page, app)
    await showToast(page)
    let t = await box(toasts(page))
    expect(t.x).toBeGreaterThanOrEqual(0)
    expect(t.x + t.width).toBeLessThanOrEqual(390)
    expect(t.y).toBeGreaterThan(844 / 2)
    expect(t.y + t.height).toBeLessThanOrEqual(844)
    await toasts(page).first().getByRole('button', { name: 'Dismiss' }).click()
    await expect(toasts(page)).toHaveCount(0)

    await page.getByTestId('ride-button').click()
    await expect(page.getByTestId('ride-hud')).toBeVisible()
    await page.keyboard.press('Control+s')
    await expect(toasts(page).last()).toBeVisible()
    const hud = await box(page.getByTestId('ride-hud'))
    t = await box(toasts(page).last())
    expect(overlap(t, hud)).toBe(false)
  })
})
