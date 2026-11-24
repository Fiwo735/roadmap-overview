import { expect, test } from './fixtures'

test.describe('app shell and map', () => {
  test('loads with the map, tiles, attribution and controls', async ({ page, app, mocks }) => {
    await app.goto()

    await expect(page.getByRole('banner')).toContainText('Roadmap Overview')
    await expect(page.getByTestId('trip-title')).toHaveValue('My campervan trip')
    await expect(page.getByTestId('sidebar')).toBeVisible()
    await expect(page.getByTestId('places-empty')).toBeVisible()

    await expect(page.locator('.leaflet-container')).toBeVisible()
    expect(await page.locator('.leaflet-tile-loaded').count()).toBeGreaterThan(0)
    expect(mocks.tiles.requests).toBeGreaterThan(0)

    await expect(page.locator('.leaflet-control-attribution')).toContainText('© OpenStreetMap contributors')
    await expect(page.locator('.leaflet-control-scale')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zoom out' })).toBeVisible()

    // Tiles are downloaded with CORS and drawn on canvases, with the outlines on the sea hidden (seaOutlines.spec.ts).
    expect(await page.locator('.leaflet-tile-loaded').first().evaluate((tile) => tile.tagName)).toBe('CANVAS')
    expect(mocks.blocked).toEqual([])
  })

  test('starts on Europe when the trip has no places', async ({ app }) => {
    await app.goto()
    const view = await app.mapView()
    expect(view.zoom).toBe(4)
    expect(view.lat).toBeCloseTo(50, 0)
    expect(view.lng).toBeCloseTo(10, 0)
  })

  test('creates the draw-order panes', async ({ page, app }) => {
    await app.goto()
    const zIndexes = await page.evaluate(() => {
      const map = window.__ROADMAP__!.getMap()!
      return ['ro-route-casing', 'ro-route', 'ro-via', 'ro-markers', 'ro-labels', 'ro-ride'].map((name) =>
        Number(map.getPane(name)?.style.zIndex),
      )
    })
    expect(zIndexes.every(Number.isFinite)).toBe(true)
    expect([...zIndexes].sort((a, b) => a - b)).toEqual(zIndexes)
  })

  test('zoom control zooms the map', async ({ page, app }) => {
    await app.goto()
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect.poll(async () => (await app.mapView()).zoom).toBe(5)
  })
})

test.describe('theme', () => {
  test('toggle flips data-theme and the choice survives a reload', async ({ page, app }) => {
    await app.goto()
    const html = page.locator('html')
    await expect(html).toHaveAttribute('data-theme', 'light')

    await page.getByTestId('theme-toggle').click()
    await expect(html).toHaveAttribute('data-theme', 'dark')
    expect((await app.ui()).theme).toBe('dark')
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark')

    await page.reload()
    await expect(html).toHaveAttribute('data-theme', 'dark')

    await page.getByTestId('theme-toggle').click()
    await expect(html).toHaveAttribute('data-theme', 'light')
    await page.reload()
    await expect(html).toHaveAttribute('data-theme', 'light')
  })

  test('map tiles keep their own colours in dark mode', async ({ page, app }) => {
    await app.goto()
    await page.getByTestId('theme-toggle').click()
    const filter = await page.locator('.leaflet-tile-pane').evaluate((el) => getComputedStyle(el).filter)
    expect(filter).toBe('none')
  })

  test.describe('system dark preference', () => {
    test.use({ colorScheme: 'dark' })

    test('defaults to dark, and an explicit light choice wins afterwards', async ({ page, app }) => {
      await app.goto()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

      await page.getByTestId('theme-toggle').click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    })
  })
})

test.describe('trip title, undo and redo', () => {
  test('editing the title is one undo step; undo and redo restore it', async ({ page, app }) => {
    await app.goto()
    const title = page.getByTestId('trip-title')
    const undo = page.getByRole('button', { name: 'Undo' })
    const redo = page.getByRole('button', { name: 'Redo' })
    await expect(undo).toBeDisabled()
    await expect(redo).toBeDisabled()

    await title.click()
    await title.fill('Norway 2026')
    // Typing alone does not touch the store.
    expect((await app.trip()).title).toBe('My campervan trip')
    await title.press('Enter')

    expect((await app.trip()).title).toBe('Norway 2026')
    expect(await app.history()).toEqual({ past: 1, future: 0 })
    await expect(undo).toBeEnabled()

    await undo.click()
    await expect(title).toHaveValue('My campervan trip')
    await expect(undo).toBeDisabled()
    await expect(redo).toBeEnabled()

    await redo.click()
    await expect(title).toHaveValue('Norway 2026')
    await expect(redo).toBeDisabled()
  })

  test('Escape cancels an edit and commits nothing', async ({ page, app }) => {
    await app.goto()
    const title = page.getByTestId('trip-title')
    await title.click()
    await title.fill('Never mind')
    await title.press('Escape')
    await expect(title).toHaveValue('My campervan trip')
    expect(await app.history()).toEqual({ past: 0, future: 0 })
  })

  test('blur commits, and an unchanged title records nothing', async ({ page, app }) => {
    await app.goto()
    const title = page.getByTestId('trip-title')
    await title.click()
    await title.press('Tab')
    expect(await app.history()).toEqual({ past: 0, future: 0 })

    await title.click()
    await title.fill('Alps loop')
    await page.getByTestId('sidebar').click()
    expect((await app.trip()).title).toBe('Alps loop')
    expect(await app.history()).toEqual({ past: 1, future: 0 })
  })

  test('keyboard shortcuts undo and redo, except while typing in a field', async ({ page, app }) => {
    await app.goto()
    const id = (await app.addPlaces('Berlin'))[0]
    await app.addPlaces('Prague')
    expect((await app.trip()).places).toHaveLength(2)

    await page.locator('.leaflet-container').click({ position: { x: 600, y: 300 } })
    await page.keyboard.press('Control+z')
    expect((await app.trip()).places).toHaveLength(1)
    await page.keyboard.press('Control+Shift+z')
    expect((await app.trip()).places).toHaveLength(2)
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+y')
    expect((await app.trip()).places).toHaveLength(2)
    expect((await app.trip()).places[0].id).toBe(id)

    // While a modal dialog is open the trip behind it must not change (neither undo nor redo).
    const openDialog = () =>
      page.evaluate(() => {
        const dialog = document.createElement('dialog')
        dialog.id = 'test-dialog'
        dialog.innerHTML = '<button>OK</button>'
        document.body.appendChild(dialog)
        dialog.showModal()
      })
    const closeDialog = () => page.evaluate(() => document.getElementById('test-dialog')!.remove())

    await openDialog()
    await page.keyboard.press('Control+z')
    expect(await app.history()).toEqual({ past: 2, future: 0 })
    await closeDialog()
    await page.keyboard.press('Control+z')
    expect(await app.history()).toEqual({ past: 1, future: 1 })

    await openDialog()
    await page.keyboard.press('Control+Shift+z')
    await page.keyboard.press('Control+y')
    expect(await app.history()).toEqual({ past: 1, future: 1 })
    await closeDialog()
    await page.keyboard.press('Control+y')
    expect(await app.history()).toEqual({ past: 2, future: 0 })

    // In a text field the shortcut belongs to the browser's own text undo.
    const title = page.getByTestId('trip-title')
    await title.click()
    await title.fill('typing')
    await page.keyboard.press('Control+z')
    expect((await app.trip()).places).toHaveLength(2)
  })
})

test.describe('autosave', () => {
  test('restores the title after a reload, even straight after the edit', async ({ page, app }) => {
    await app.goto()
    const title = page.getByTestId('trip-title')
    await title.click()
    await title.fill('Autosaved trip')
    await title.press('Enter')

    await page.reload()
    await expect(page.getByTestId('trip-title')).toHaveValue('Autosaved trip')
    // A restored trip starts with a clean history.
    expect(await app.history()).toEqual({ past: 0, future: 0 })
  })

  test('saves places with the trip file format and restores them', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await expect.poll(async () => (await app.savedFile())?.trip.places.length).toBe(2)

    const file = await app.savedFile()
    expect(file).toMatchObject({ format: 'roadmap-overview/trip', version: 1 })
    expect(file!.trip.legs).toHaveLength(1)

    await page.reload()
    await app.ready()
    const trip = await app.trip()
    expect(trip.places.map((p) => p.name)).toEqual(['Lyon', 'Annecy'])
    expect(trip.legs).toHaveLength(1)
    // The map opens on the restored places instead of Europe.
    const view = await app.mapView()
    expect(view.zoom).toBeGreaterThan(5)
    expect(view.lng).toBeGreaterThan(4)
    expect(view.lng).toBeLessThan(7)
  })

  test('corrupt saved data does not crash the app', async ({ page, app }) => {
    await app.seedRawStorage('roadmap-overview:v1:current', '{"format": "nope"')
    await app.goto()
    await expect(page.getByTestId('trip-title')).toHaveValue('My campervan trip')
    await expect(page.getByTestId('toast')).toContainText('could not be restored')
    expect(await page.evaluate(() => localStorage.getItem('roadmap-overview:v1:corrupt'))).toBe('{"format": "nope"')
  })
})
