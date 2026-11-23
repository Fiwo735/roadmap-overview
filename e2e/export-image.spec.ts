import { readFileSync } from 'node:fs'
import type { Download, Locator, Page } from '@playwright/test'
import { STORAGE_KEYS, expect, test, type App } from './fixtures'

const OPTIONS_KEY = 'roadmap-overview:export-options'

const button = (page: Page) => page.getByTestId('export-image-button')
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export image' })
const preview = (page: Page) => page.getByTestId('export-preview')
const download = (page: Page) => page.getByTestId('export-download')
const outcome = (page: Page) => page.getByTestId('export-outcome')

/** Open the app with these places, every leg routed (by the OSRM mock). */
async function openTrip(page: Page, app: App, ...names: string[]) {
  await app.goto()
  await app.addPlaces(...names)
  for (let i = 0; i + 1 < names.length; i++) await expect(page.getByTestId('leg-connector').nth(i)).toHaveAttribute('data-status', 'ok')
}

async function openDialog(page: Page) {
  await button(page).click()
  await expect(dialog(page)).toBeVisible()
  await expectPreviewReady(page)
}

const expectPreviewReady = (page: Page) => expect(preview(page)).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })

/** The preview's pixels, as a data URL (to see whether it changed). */
const previewImage = (page: Page) => preview(page).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())

/** The RGBA of one preview pixel. */
const previewPixel = (page: Page, x: number, y: number) =>
  preview(page).evaluate((canvas: HTMLCanvasElement, [px, py]) => Array.from(canvas.getContext('2d')!.getImageData(px, py, 1, 1).data), [x, y])

/** Size from the IHDR chunk of a PNG file. */
function pngSize(file: Buffer): { width: number; height: number } {
  expect(file.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(file.subarray(12, 16).toString('ascii')).toBe('IHDR')
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) }
}

async function saved(d: Download): Promise<Buffer> {
  return readFileSync((await d.path()) as string)
}

async function downloadPng(page: Page, trigger: Locator = download(page)): Promise<{ file: Buffer; name: string }> {
  const [d] = await Promise.all([page.waitForEvent('download'), trigger.click()])
  return { file: await saved(d), name: d.suggestedFilename() }
}

interface PngStats {
  width: number
  height: number
  /** Share of pixels that are exactly the mock tile's grey. */
  tileShare: number
  /** Pixels in the drive route's blue. */
  routeBlue: number
  /** RGB of the pixels asked for. */
  at: number[][]
  /** Dark pixels (text) in the box asked for. */
  dark: number
}

/** Decode a PNG in the page and look at its pixels. */
async function analyse(page: Page, file: Buffer, points: [number, number][] = [], darkBox?: [number, number, number, number]): Promise<PngStats> {
  return page.evaluate(
    async ({ base64, points, darkBox }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      let tile = 0
      let blue = 0
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
        if (r === 230 && g === 230 && b === 230) tile++
        if (Math.abs(r - 26) < 12 && Math.abs(g - 115) < 12 && Math.abs(b - 232) < 12) blue++
      }
      const at = points.map(([x, y]) => {
        const i = (y * canvas.width + x) * 4
        return [data[i], data[i + 1], data[i + 2]]
      })
      let dark = 0
      if (darkBox) {
        const [x0, y0, x1, y1] = darkBox
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * canvas.width + x) * 4
            if (data[i] + data[i + 1] + data[i + 2] < 300) dark++
          }
        }
      }
      return { width: canvas.width, height: canvas.height, tileShare: tile / (data.length / 4), routeBlue: blue, at, dark }
    },
    { base64: file.toString('base64'), points, darkBox },
  )
}

const luminance = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

test.describe('export image', () => {
  test('the top bar button opens the dialog with a preview of the map and the trip', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await expect(dialog(page)).toHaveCount(0)
    await button(page).click()
    await expect(dialog(page)).toBeVisible()
    await expectPreviewReady(page)

    // The preview is a canvas shaped like the default size (landscape, 16:9) with real content in it.
    const box = await preview(page).evaluate((c: HTMLCanvasElement) => ({ width: c.width, height: c.height }))
    expect(box.width / box.height).toBeCloseTo(16 / 9, 2)
    const png = await analyse(page, Buffer.from((await previewImage(page)).split(',')[1], 'base64'))
    expect(png.tileShare).toBeGreaterThan(0.3) // the map tiles
    expect(png.routeBlue).toBeGreaterThan(100) // the route

    await expect(page.getByTestId('export-size')).toHaveText('1920 × 1080 px')
    await expect(page.getByTestId('export-preset-landscape').getByRole('radio')).toBeChecked()
    await expect(download(page)).toBeEnabled()
  })

  test('closes with Escape and gives the focus back to the button', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openDialog(page)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(button(page)).toBeFocused()
    expect((await app.ui()).openDialogId).toBeNull()

    // The close button does the same.
    await openDialog(page)
    await dialog(page).getByRole('button', { name: 'Close' }).click()
    await expect(dialog(page)).toHaveCount(0)
    await expect(button(page)).toBeFocused()
  })

  const sizes = [
    { preset: 'landscape', scale: 1, width: 1920, height: 1080 },
    { preset: 'portrait', scale: 1, width: 1080, height: 1350 },
    { preset: 'square', scale: 1, width: 1080, height: 1080 },
    { preset: 'a4', scale: 1, width: 3508, height: 2480 },
    { preset: 'landscape', scale: 2, width: 3840, height: 2160 },
  ] as const

  for (const { preset, scale, width, height } of sizes) {
    test(`downloads a ${width} × ${height} PNG (${preset}, ${scale}×)`, async ({ page, app }) => {
      test.setTimeout(60_000)
      await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
      await app.page.evaluate(() => window.__ROADMAP__!.trip.getState().setTitle('Alps: Lyon → Zürich!'))
      await openDialog(page)
      await page.getByTestId(`export-preset-${preset}`).click()
      if (scale === 2) await page.getByRole('radio', { name: '2× sharper' }).click()
      await expect(page.getByTestId('export-size')).toHaveText(`${width} × ${height} px`)
      await expectPreviewReady(page)

      const { file, name } = await downloadPng(page)
      expect(name).toBe('alps-lyon-zurich.png')
      expect(pngSize(file)).toEqual({ width, height })
      await expect(outcome(page)).toHaveAttribute('data-kind', 'success')
      await expect(outcome(page)).toContainText(`${width} × ${height} px`)

      // The picture is the map with the trip drawn on it, not a blank canvas.
      const stats = await analyse(page, file)
      expect(stats.tileShare).toBeGreaterThan(0.3)
      expect(stats.routeBlue).toBeGreaterThan(500)
    })
  }

  test('draws the card in the corner, the attribution in the other, and the route in between', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await openDialog(page)
    const { file } = await downloadPng(page)
    // u = 1.2 at 1920 × 1080: the card starts 24 px from the corner and the plate is flush with the bottom-right one.
    const stats = await analyse(page, file, [[30, 30], [1915, 1075], [1000, 20]], [1620, 1056, 1920, 1080])
    expect(luminance(stats.at[0])).toBeGreaterThan(250) // the card's white
    expect(luminance(stats.at[1])).toBeGreaterThan(240) // the attribution plate
    expect(stats.at[2]).toEqual([230, 230, 230]) // plain map elsewhere
    expect(stats.dark).toBeGreaterThan(100) // the attribution text
  })

  test('toggles show and hide the card, names, day numbers and legend', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await app.page.evaluate(() => {
      const s = window.__ROADMAP__!.trip.getState()
      s.updateLeg(s.trip.legs[1].id, { mode: 'ferry' })
    })
    await openDialog(page)
    const base = await previewImage(page)
    // Preview pixel at the card's corner: 12 × 12 (24 px at half size) is the card's border, 16 × 16 is inside it.
    expect(luminance(await previewPixel(page, 16, 16))).toBeGreaterThan(250)

    const toggles = ['card', 'labels', 'days', 'legend'] as const
    for (const name of toggles) {
      const toggle = page.getByTestId(`export-toggle-${name}`)
      const before = await toggle.getAttribute('aria-checked')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true')
      await expectPreviewReady(page)
      await expect.poll(() => previewImage(page), { message: `${name} changes the picture` }).not.toBe(base)
      await toggle.click() // and back
      await expectPreviewReady(page)
      await expect.poll(() => previewImage(page), { message: `${name} back again` }).toBe(base)
    }

    await page.getByTestId('export-toggle-card').click()
    await expectPreviewReady(page)
    expect(await previewPixel(page, 16, 16)).toEqual([230, 230, 230, 255]) // plain map where the card was
  })

  test('the legend needs more than one mode', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await openDialog(page)
    await expect(page.getByTestId('export-toggle-legend')).toBeDisabled()
    await expect(dialog(page)).toContainText('more than one kind of travel')
    await page.keyboard.press('Escape')
    await app.page.evaluate(() => {
      const s = window.__ROADMAP__!.trip.getState()
      s.updateLeg(s.trip.legs[0].id, { mode: 'train' })
    })
    await openDialog(page)
    await expect(page.getByTestId('export-toggle-legend')).toBeEnabled()
  })

  test('the card follows the app theme unless a style is chosen', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await page.getByTestId('theme-toggle').click()
    expect((await app.ui()).theme).toBe('dark')
    await openDialog(page)
    expect(luminance(await previewPixel(page, 16, 16))).toBeLessThan(60) // dark card, as the app

    await page.getByRole('radio', { name: 'Light', exact: true }).click()
    await expectPreviewReady(page)
    await expect.poll(async () => luminance(await previewPixel(page, 16, 16))).toBeGreaterThan(250)
    const { file } = await downloadPng(page)
    expect(luminance((await analyse(page, file, [[30, 30]])).at[0])).toBeGreaterThan(250)

    await page.getByRole('radio', { name: 'Dark', exact: true }).click()
    await expect.poll(async () => luminance(await previewPixel(page, 16, 16))).toBeLessThan(60)
    await page.getByRole('radio', { name: 'Match app' }).click()
    await expect.poll(async () => luminance(await previewPixel(page, 16, 16))).toBeLessThan(60)
  })

  test('asks the tile server for no more than 300 tiles, six at a time', async ({ page, app, mocks }) => {
    test.setTimeout(90_000)
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await app.settle()
    await openDialog(page)
    await page.getByTestId('export-preset-a4').click()
    await page.getByRole('radio', { name: '2× sharper' }).click()
    await expectPreviewReady(page)

    mocks.tiles.delayMs = 40
    mocks.tiles.peak = 0
    const before = new Set(mocks.tiles.urls)
    const { file } = await downloadPng(page)
    expect(pngSize(file)).toEqual({ width: 7016, height: 4960 })
    const fresh = new Set(mocks.tiles.urls.filter((u) => !before.has(u)))
    expect(fresh.size).toBeGreaterThan(100) // a big picture needs many tiles…
    expect(fresh.size).toBeLessThanOrEqual(300) // …but never more than the cap
    expect(mocks.tiles.peak).toBeLessThanOrEqual(6)
    for (const url of fresh) expect(url).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/)
  })

  test('never has more than six tiles in flight or asks for one twice, however fast the options change', async ({ page, app, mocks }) => {
    test.setTimeout(60_000)
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await app.settle()
    mocks.tiles.delayMs = 80
    const before = mocks.tiles.urls.length
    mocks.tiles.peak = 0
    await button(page).click()
    await expect(dialog(page)).toBeVisible()
    // Previews are overtaken one after the other, then a download starts while the last one is still loading.
    for (const id of ['portrait', 'square', 'a4', 'landscape', 'a4']) {
      await page.getByTestId(`export-preset-${id}`).click()
      await page.waitForTimeout(300)
    }
    await page.getByRole('radio', { name: '2× sharper' }).click()
    await page.waitForTimeout(300)
    await downloadPng(page)
    await expect(outcome(page)).toHaveAttribute('data-kind', 'success')
    const fresh = mocks.tiles.urls.slice(before)
    expect(fresh.length).toBeGreaterThan(20)
    expect(new Set(fresh).size).toBe(fresh.length) // no tile twice
    expect(mocks.tiles.peak).toBeLessThanOrEqual(6)
  })

  test('shows progress while the picture is made, and keeps the buttons from being pressed twice', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await openDialog(page)
    await page.getByTestId('export-preset-portrait').click()
    await expectPreviewReady(page)
    mocks.tiles.delayMs = 150

    const [d] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await download(page).click()
        await expect(page.getByTestId('export-progress')).toBeVisible()
        await expect(page.getByTestId('export-progress')).toContainText(/Loading map tiles \d+ of \d+/)
        await expect(download(page)).toBeDisabled()
        await expect(page.getByTestId('export-copy')).toBeDisabled()
      })(),
    ])
    expect(pngSize(await saved(d))).toEqual({ width: 1080, height: 1350 })
    await expect(page.getByTestId('export-progress')).toHaveCount(0)
    await expect(download(page)).toBeEnabled()
  })

  test('still makes the image when tiles cannot be loaded, and says so', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    mocks.tiles.failWith = 'http-500' // the map on the page has its tiles; the picture's are all refused
    await openDialog(page)
    await expect(page.getByTestId('export-notes')).toContainText('map tiles could not be loaded')

    const { file } = await downloadPng(page)
    expect(pngSize(file)).toEqual({ width: 1920, height: 1080 })
    await expect(outcome(page)).toHaveAttribute('data-kind', 'warning')
    await expect(outcome(page)).toContainText('could not be loaded')
    // No map, but the trip is on it: the land colour behind the missing tiles, the route and the card.
    const stats = await analyse(page, file)
    expect(stats.tileShare).toBeLessThan(0.001) // not a tile in sight (a few pixels may be that grey by chance)
    expect(stats.routeBlue).toBeGreaterThan(500)
  })

  test('asks for the tiles that failed again when the download is pressed, so a passing error leaves no hole', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    mocks.tiles.failWith = 'http-500'
    await openDialog(page)
    await expect(page.getByTestId('export-notes')).toContainText('map tiles could not be loaded')
    mocks.tiles.failWith = null // the server has recovered; the preview would still leave the tiles alone for a while
    const { file } = await downloadPng(page)
    await expect(outcome(page)).toHaveAttribute('data-kind', 'success')
    expect((await analyse(page, file)).tileShare).toBeGreaterThan(0.3)
  })

  test('warns up front about an image too big for some browsers', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openDialog(page)
    await expect(page.getByTestId('export-notes')).toHaveCount(0)
    await page.getByTestId('export-preset-a4').click()
    await page.getByRole('radio', { name: '2× sharper' }).click()
    await expect(page.getByTestId('export-notes')).toContainText('Very large image — may fail on iPhone/iPad; try 1× or a smaller size.')
    await page.getByRole('radio', { name: '1×', exact: true }).click()
    await expect(page.getByTestId('export-notes')).toHaveCount(0)
  })

  test('copies the image to the clipboard', async ({ page, app, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await openDialog(page)
    await page.getByTestId('export-copy').click()
    await expect(outcome(page)).toContainText('Image copied to the clipboard (1920 × 1080 px)')
    const copied = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read()
      const blob = await item.getType('image/png')
      const bitmap = await createImageBitmap(blob)
      return { types: item.types, width: bitmap.width, height: bitmap.height }
    })
    expect(copied).toEqual({ types: ['image/png'], width: 1920, height: 1080 })
  })

  test('has nothing to export for an empty trip', async ({ page, app }) => {
    await app.goto()
    await button(page).click()
    await expect(page.getByTestId('export-empty')).toBeVisible()
    await expect(download(page)).toBeDisabled()
    await expect(page.getByTestId('export-copy')).toBeDisabled()
    await expect(preview(page)).toHaveCount(0)
    // Adding a place while it is open brings the preview.
    await app.addPlaces('Lyon')
    await expectPreviewReady(page)
    await expect(download(page)).toBeEnabled()
  })

  test('a trip with one place still makes a map', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await openDialog(page)
    const { file } = await downloadPng(page)
    const stats = await analyse(page, file)
    expect(stats.tileShare).toBeGreaterThan(0.3)
  })

  test('remembers what was chosen', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openDialog(page)
    await page.getByTestId('export-preset-square').click()
    await page.getByTestId('export-toggle-days').click()
    await page.getByTestId('export-toggle-labels').click()
    await page.getByRole('radio', { name: 'Dark', exact: true }).click()
    await expectPreviewReady(page)
    await page.keyboard.press('Escape')

    await openDialog(page)
    await expect(page.getByTestId('export-preset-square').getByRole('radio')).toBeChecked()
    await expect(page.getByTestId('export-toggle-days')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('export-toggle-labels')).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked()

    // And after a reload, from localStorage.
    expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), OPTIONS_KEY)) as string)).toMatchObject({ preset: 'square', days: true, labels: false, cardStyle: 'dark' })
    await page.keyboard.press('Escape')
    await page.reload()
    await page.waitForFunction(() => window.__ROADMAP__?.getMap() != null)
    await button(page).click()
    await expect(page.getByTestId('export-preset-square').getByRole('radio')).toBeChecked()
  })

  test('ignores damaged saved choices', async ({ page, app }) => {
    await app.seedRawStorage(OPTIONS_KEY, '{"preset":"huge","scale":7,"card":"yes","labels":false}')
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openDialog(page)
    await expect(page.getByTestId('export-preset-landscape').getByRole('radio')).toBeChecked()
    await expect(page.getByTestId('export-toggle-labels')).toHaveAttribute('aria-checked', 'false') // the valid part survives
    await expect(page.getByTestId('export-toggle-card')).toHaveAttribute('aria-checked', 'true')
  })

  test('warns about legs that could not be routed, and still exports', async ({ page, app, mocks }) => {
    mocks.osrm.failWith = 'NoRoute'
    await app.goto()
    await app.addPlaces('Lyon', 'Annecy')
    await expect(page.getByTestId('leg-connector').first()).toHaveAttribute('data-status', 'error')
    await openDialog(page)
    await expect(page.getByTestId('export-notes')).toContainText('could not be routed')
    const { file } = await downloadPng(page)
    expect(pngSize(file)).toEqual({ width: 1920, height: 1080 })
  })

  test('does not start more tiles once the dialog is closed', async ({ page, app, mocks }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await openDialog(page)
    await page.getByTestId('export-preset-a4').click()
    await expectPreviewReady(page)
    mocks.tiles.delayMs = 300
    await download(page).click()
    await expect(page.getByTestId('export-progress')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect.poll(() => mocks.tiles.inFlight, { timeout: 5_000 }).toBe(0)
    const settled = mocks.tiles.requests
    await page.waitForTimeout(800)
    expect(mocks.tiles.requests).toBe(settled)
    expect(mocks.blocked).toEqual([])
  })

  test('autosaved storage is untouched by exporting', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    const before = await app.history()
    await openDialog(page)
    await downloadPng(page)
    expect(await app.history()).toEqual(before) // no undo step
    expect(await page.evaluate((k) => localStorage.getItem(k) !== null, STORAGE_KEYS.trip)).toBe(true)
  })
})
