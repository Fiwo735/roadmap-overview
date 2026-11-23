import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { createTrip, syncLegs } from '../src/lib/trip'
import { serializeTripFile } from '../src/lib/tripFile'
import type { Place } from '../src/types/trip'
import { expect, placeInput, test } from './fixtures'

// lz-string is a CommonJS package: Node's ESM loader only exposes it through require.
const lz = createRequire(import.meta.url)('lz-string') as typeof import('lz-string')

const place = (id: string, name: string, day: number): Place => ({ id, ...placeInput(name), day })
const [Lyon, Annecy, Zurich] = [place('p0', 'Lyon', 0), place('p1', 'Annecy', 1), place('p2', 'Zurich', 0)]

/**
 * A toast can outlive the moment it was shown. Its buttons ("Undo", "Restore previous trip", …) change the
 * trip, so they have to ask the editing lock (presentation mode, a ride) when they are clicked, not when the
 * toast was made.
 */
const toasts = (page: Page) => page.getByTestId('toast')
const opened = (page: Page) => toasts(page).filter({ hasText: 'Opened' })

/** The sample trip, opened from the File menu: its toast offers "Undo". The toast is held on screen by the pointer. */
async function openSampleWithUndoToast(page: Page, app: { trip: () => Promise<{ places: unknown[] }> }) {
  await page.getByTestId('file-menu').click()
  await page.getByRole('menuitem', { name: 'Load sample trip' }).click()
  await expect(opened(page)).toBeVisible()
  expect((await app.trip()).places).toHaveLength(12)
  // A pointer over a toast stops its countdown: the test can take its time.
  await opened(page).hover()
}

test.describe('toast actions respect the editing lock', () => {
  test('presentation mode: "Undo" on a toast that is still up refuses and says why; it works again afterwards', async ({ page, app }) => {
    await app.goto()
    await openSampleWithUndoToast(page, app)

    await page.getByTestId('present-toggle').click()
    await expect(page.getByTestId('sidebar')).toBeHidden()
    await opened(page).getByRole('button', { name: 'Undo' }).click()
    await expect(toasts(page).filter({ hasText: 'Leave presentation mode (Esc) first' })).toBeVisible()
    // Nothing happened, and the offer stands.
    expect((await app.trip()).places).toHaveLength(12)
    await expect(opened(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('sidebar')).toBeVisible()
    await opened(page).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await app.trip()).places.length).toBe(0)
  })

  test('a ride: "Undo" refuses while it runs and works after it is closed', async ({ page, app }) => {
    await app.goto()
    await openSampleWithUndoToast(page, app)

    await page.getByTestId('ride-button').click()
    await expect(page.getByTestId('ride-hud')).toBeVisible()
    await opened(page).getByRole('button', { name: 'Undo' }).click()
    await expect(toasts(page).filter({ hasText: 'Close the ride (Esc) first' })).toBeVisible()
    expect((await app.trip()).places).toHaveLength(12)
    await expect(page.getByTestId('ride-hud')).toBeVisible()

    await page.getByTestId('ride-close').click()
    await expect(page.getByTestId('ride-hud')).toBeHidden()
    await opened(page).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await app.trip()).places.length).toBe(0)
  })

  test('"Restore previous trip" on a presentation link’s toast refuses until presenting ends', async ({ page, app }) => {
    const mine = createTrip({ id: 'mine', title: 'Mine', places: [Lyon, Annecy], legs: syncLegs([Lyon, Annecy], []) })
    await app.seedSavedTrip(serializeTripFile(mine))
    const linked = createTrip({ id: 'linked', title: 'Linked', places: [Zurich], legs: [] })
    await page.goto('/#trip=' + lz.compressToEncodedURIComponent(JSON.stringify(serializeTripFile(linked))) + '&present')
    await app.ready()
    await expect.poll(async () => (await app.trip()).title).toBe('Linked')
    await expect(page.locator('.app')).toHaveAttribute('data-presenting', 'true')
    const kept = toasts(page).filter({ hasText: 'Your previous trip was kept' })
    await kept.hover()
    await kept.getByRole('button', { name: 'Restore previous trip' }).click()
    await expect(toasts(page).filter({ hasText: 'Leave presentation mode (Esc) first' })).toBeVisible()
    expect((await app.trip()).title).toBe('Linked')

    await page.keyboard.press('Escape')
    await kept.getByRole('button', { name: 'Restore previous trip' }).click()
    await expect.poll(async () => (await app.trip()).title).toBe('Mine')
  })
})
