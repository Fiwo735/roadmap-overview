import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import type { TripFile } from '../src/types/trip'
import { expect, test } from './fixtures'

const row = (page: Page, i: number) => page.getByTestId('place-item').nth(i)
const noteField = (page: Page) => page.getByTestId('place-note')
const indicator = (page: Page, i: number) => row(page, i).getByTestId('place-note-indicator')

/** Open the places row `i` (it expands into search, address and note). */
async function expand(page: Page, i: number) {
  await row(page, i).getByTestId('place-main').click()
  await expect(noteField(page)).toBeVisible()
}

test.describe('place notes', () => {
  test('are written in the expanded row: saved when the field is left, as one undo step', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    const start = (await app.history()).past
    await expand(page, 0)
    await expect(noteField(page)).toHaveValue('')
    await expect(noteField(page)).toHaveAttribute('placeholder', /note/i)
    await expect(indicator(page, 0)).toHaveCount(0)

    await noteField(page).fill('Parking by the river.')
    await noteField(page).pressSequentially(' Market on Sunday.')
    // Typing alone changes nothing in the trip ...
    expect((await app.trip()).places[0].note).toBeUndefined()
    expect((await app.history()).past).toBe(start)
    // ... leaving the field saves it: one history step for the whole edit.
    await page.keyboard.press('Tab')
    expect((await app.trip()).places[0].note).toBe('Parking by the river. Market on Sunday.')
    expect((await app.history()).past).toBe(start + 1)
    await expect(indicator(page, 0)).toBeVisible()
    await expect(indicator(page, 0)).toHaveAttribute('title', 'Parking by the river. Market on Sunday.')

    // Undo and redo move the whole note, and the field follows.
    await page.keyboard.press('Control+z')
    expect((await app.trip()).places[0].note).toBeUndefined()
    await expect(noteField(page)).toHaveValue('')
    await expect(indicator(page, 0)).toHaveCount(0)
    await page.keyboard.press('Control+Shift+z')
    expect((await app.trip()).places[0].note).toBe('Parking by the river. Market on Sunday.')
    await expect(noteField(page)).toHaveValue('Parking by the river. Market on Sunday.')
  })

  test('an edit that changes nothing adds no step; clearing removes the note; spaces alone are no note', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await expand(page, 0)
    await noteField(page).fill('Camping')
    await page.keyboard.press('Tab')
    const steps = (await app.history()).past

    await noteField(page).focus()
    await noteField(page).fill('  Camping  ')
    await page.keyboard.press('Tab')
    expect((await app.trip()).places[0].note).toBe('Camping')
    expect((await app.history()).past).toBe(steps)

    await noteField(page).fill('')
    await page.keyboard.press('Tab')
    expect((await app.trip()).places[0].note).toBeUndefined()
    expect((await app.history()).past).toBe(steps + 1)
    await expect(indicator(page, 0)).toHaveCount(0)

    await noteField(page).fill('   ')
    await page.keyboard.press('Tab')
    expect((await app.trip()).places[0].note).toBeUndefined()
    expect((await app.history()).past).toBe(steps + 1)
  })

  test('Escape throws away what was typed and closes the row; clicking elsewhere saves it', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await expand(page, 0)
    await noteField(page).fill('Not this')
    await page.keyboard.press('Escape')
    await expect(noteField(page)).toHaveCount(0)
    expect((await app.trip()).places[0].note).toBeUndefined()

    await expand(page, 0)
    await noteField(page).fill('Kept')
    // Opening another row (a click elsewhere) is leaving the field.
    await row(page, 1).getByTestId('place-main').click()
    expect((await app.trip()).places[0].note).toBe('Kept')
    await expect(row(page, 1).getByTestId('place-panel')).toBeVisible()
    await expect(noteField(page)).toHaveValue('')
  })

  test('are saved with the trip, and a note with line breaks stays as written', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await expand(page, 0)
    await noteField(page).fill('Line one')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Line two')
    await page.keyboard.press('Tab')
    expect((await app.trip()).places[0].note).toBe('Line one\nLine two')
    await expect.poll(async () => (await app.savedFile())?.trip.places[0].note).toBe('Line one\nLine two')
    await page.reload()
    await app.ready()
    await expand(page, 0)
    await expect(noteField(page)).toHaveValue('Line one\nLine two')
  })

  test('the field takes at most 1000 characters', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await expand(page, 0)
    await noteField(page).fill('x'.repeat(1200))
    await page.keyboard.press('Tab')
    expect((await app.trip()).places[0].note).toHaveLength(1000)
  })

  test('show in the marker label while it is hovered or selected, not otherwise', async ({ page, app }) => {
    await app.goto()
    const [lyon, annecy] = await app.addPlaces('Lyon', 'Annecy')
    await page.evaluate(([id]) => window.__ROADMAP__!.trip.getState().updatePlace(id, { note: 'Try the bouchons.' }), [lyon])
    // Zoomed in on the trip, so the two markers are apart.
    await page.getByTestId('fit-trip').click()
    await app.settle()
    const trip = await app.trip()
    const labels = page.locator('.leaflet-tooltip.place-label')
    await expect(labels).toHaveCount(2)
    // The note is part of the first label only, and hidden until the marker is pointed at.
    await expect(labels.locator('.place-label__note')).toHaveCount(1)
    await expect(labels.locator('.place-label__note')).toBeHidden()
    await expect(page.locator('.place-marker').first()).toHaveAttribute('aria-label', /Place 1: Lyon\. Note: Try the bouchons\./)
    await expect(page.locator('.place-marker').nth(1)).not.toHaveAttribute('aria-label', /Note/)

    const at = await app.screenPoint(trip.places[0].lat, trip.places[0].lng)
    await page.mouse.move(at.x, at.y)
    await expect(labels.locator('.place-label__note')).toBeVisible()
    await expect(labels.locator('.place-label__note')).toHaveText('Try the bouchons.')
    // A place without a note has the plain label, also when hovered.
    const other = await app.screenPoint(trip.places[1].lat, trip.places[1].lng)
    await page.mouse.move(other.x, other.y)
    await expect(labels.locator('.place-label__note')).toBeHidden()
    await expect(page.locator('.leaflet-tooltip.place-label.is-hovered')).toContainText('Annecy')

    // Selecting the place (a click on its marker, as a tap does on a phone) shows it as well.
    await page.mouse.click(at.x, at.y)
    await page.mouse.move(at.x + 300, at.y + 200)
    await expect(labels.locator('.place-label__note')).toBeVisible()

    // Editing the note updates the label.
    await page.evaluate(([id]) => window.__ROADMAP__!.trip.getState().updatePlace(id, { note: 'Closed on Mondays.' }), [lyon])
    await expect(labels.locator('.place-label__note')).toHaveText('Closed on Mondays.')
    await page.evaluate(([id]) => window.__ROADMAP__!.trip.getState().updatePlace(id, { note: undefined }), [lyon])
    await expect(labels.locator('.place-label__note')).toHaveCount(0)
    expect(annecy).toBeTruthy()
  })

  test('a long note stays inside a card of limited size', async ({ page, app }) => {
    await app.goto()
    const [id] = await app.addPlaces('Lyon')
    await page.evaluate(([i]) => window.__ROADMAP__!.trip.getState().updatePlace(i, { note: 'Word '.repeat(150) }), [id])
    await app.settle()
    const trip = await app.trip()
    const at = await app.screenPoint(trip.places[0].lat, trip.places[0].lng)
    await page.mouse.move(at.x, at.y)
    const label = page.locator('.leaflet-tooltip.place-label.is-hovered')
    await expect(label.locator('.place-label__note')).toBeVisible()
    const box = (await label.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(262)
    expect(box.height).toBeLessThan(200)
  })

  test('the sample trip’s notes show as indicators on their rows', async ({ page, app }) => {
    const file = JSON.parse(readFileSync('public/samples/hamburg-fjords.trip.json', 'utf8')) as TripFile
    const withNotes = file.trip.places.filter((p) => p.note).length
    expect(withNotes).toBeGreaterThan(0)
    await app.seedSavedTrip(file)
    await app.goto()
    await expect(page.getByTestId('place-note-indicator')).toHaveCount(withNotes)
    const first = file.trip.places.findIndex((p) => p.note)
    await expand(page, first)
    await expect(noteField(page)).toHaveValue(file.trip.places[first].note!)
  })

  test('are not editable while a ride runs or in presentation mode', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await expect(page.getByTestId('leg-connector').first()).toHaveAttribute('data-status', 'ok')
    await expand(page, 0)
    await page.getByTestId('present-toggle').click()
    // The sidebar is gone; leaving brings back a row that is not expanded any more.
    await expect(page.getByTestId('sidebar')).toBeHidden()
    await page.getByTestId('present-toggle').click()
    await expect(page.getByTestId('sidebar')).toBeVisible()
    await expect(noteField(page)).toHaveCount(0)
    await page.getByTestId('ride-button').click()
    await expect(page.getByTestId('places-panel')).toHaveAttribute('inert', '')
  })
})
