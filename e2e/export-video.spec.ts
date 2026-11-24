import { readFileSync } from 'node:fs'
import type { Download, Page } from '@playwright/test'
// Loads the typing of `window.__ROADMAP__.video` and `.ride`.
import type {} from '../src/features/export-video/debugTypes'
import type {} from '../src/features/ride/rideStore'
import { expect, test, type App } from './fixtures'

const OPTIONS_KEY = 'roadmap-overview:video-options'

const exportButton = (page: Page) => page.getByTestId('export-image-button')
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export image or video' })
const imageTab = (page: Page) => page.getByTestId('export-tab-image')
const videoTab = (page: Page) => page.getByTestId('export-tab-video')
const preview = (page: Page) => page.getByTestId('video-preview')
const render = (page: Page) => page.getByTestId('video-render')
const cancel = (page: Page) => page.getByTestId('video-cancel')
const downloadButton = (page: Page) => page.getByTestId('video-download')
const outcome = (page: Page) => page.getByTestId('video-outcome')
const scrub = (page: Page) => page.getByTestId('video-scrub')
const connector = (page: Page, i: number) => page.getByTestId('leg-connector').nth(i)

/** Open the app with these places, every leg routed (by the OSRM mock). */
async function openTrip(page: Page, app: App, ...names: string[]) {
  await app.goto()
  await app.addPlaces(...names)
  for (let i = 0; i + 1 < names.length; i++) await expect(connector(page, i)).toHaveAttribute('data-status', 'ok')
}

async function openVideoTab(page: Page) {
  await exportButton(page).click()
  await expect(dialog(page)).toBeVisible()
  await videoTab(page).click()
  await expectPreviewReady(page)
}

const expectPreviewReady = (page: Page) => expect(preview(page)).toHaveAttribute('data-status', 'ready', { timeout: 20_000 })

/** The preview's pixels, as a data URL (to see whether it changed). */
const previewImage = (page: Page) => preview(page).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())

/** Move the preview to a moment of the video (0 … 1000) and wait for the frame to be drawn. */
async function scrubTo(page: Page, value: number) {
  await scrub(page).fill(String(value))
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/**
 * What is in a corner of the preview canvas: dark pixels (the credit's letters) in the bottom-right one, white ones (the card's
 * plate, the mock tiles are grey) in the top-left one.
 */
const darkIn = (page: Page, box: 'credit' | 'card') =>
  preview(page).evaluate((canvas: HTMLCanvasElement, which) => {
    const { width, height } = canvas
    const [x0, y0, x1, y1] = which === 'credit' ? [width - 230, height - 26, width, height] : [4, 4, 150, 90]
    const { data } = canvas.getContext('2d')!.getImageData(x0, y0, x1 - x0, y1 - y0)
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      if (which === 'credit' ? data[i] + data[i + 1] + data[i + 2] < 300 : data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) count++
    }
    return count
  }, box)

async function saved(d: Download): Promise<Buffer> {
  return readFileSync((await d.path()) as string)
}

/** Press Render, wait for the finished video, and download it. */
async function renderAndDownload(page: Page): Promise<{ file: Buffer; name: string }> {
  await render(page).click()
  await expect(downloadButton(page)).toBeVisible({ timeout: 90_000 })
  const [d] = await Promise.all([page.waitForEvent('download'), downloadButton(page).click()])
  return { file: await saved(d), name: d.suggestedFilename() }
}

// ---- Reading an MP4 (just enough to check what is in it) ----

interface Box {
  type: string
  start: number
  end: number
  /** Where the box's own data starts (after the 8-byte header). */
  data: number
}

function boxesOf(file: Buffer, start = 0, end = file.length): Box[] {
  const out: Box[] = []
  let at = start
  while (at + 8 <= end) {
    let size = file.readUInt32BE(at)
    if (size === 1) size = Number(file.readBigUInt64BE(at + 8))
    if (size < 8) break
    const header = file.readUInt32BE(at) === 1 ? 16 : 8
    out.push({ type: file.toString('ascii', at + 4, at + 8), start: at, end: Math.min(end, at + size), data: at + header })
    at += size
  }
  return out
}

const find = (file: Buffer, parent: Box | null, type: string): Box => {
  const box = boxesOf(file, parent?.data ?? 0, parent?.end ?? file.length).find((b) => b.type === type)
  if (!box) throw new Error(`no ${type} box`)
  return box
}

function readMp4(file: Buffer) {
  const moov = find(file, null, 'moov')
  const mvhd = find(file, moov, 'mvhd')
  const v1 = file.readUInt8(mvhd.data) === 1
  const timescale = file.readUInt32BE(mvhd.data + (v1 ? 20 : 12))
  const duration = v1 ? Number(file.readBigUInt64BE(mvhd.data + 24)) : file.readUInt32BE(mvhd.data + 16)
  const trak = find(file, moov, 'trak')
  const tkhd = find(file, trak, 'tkhd')
  return {
    brands: file.toString('ascii', find(file, null, 'ftyp').data, find(file, null, 'ftyp').data + 4),
    seconds: duration / timescale,
    width: file.readUInt32BE(tkhd.end - 8) / 65536,
    height: file.readUInt32BE(tkhd.end - 4) / 65536,
  }
}

const isWebm = (file: Buffer) => file.subarray(0, 4).toString('hex') === '1a45dfa3'

test.describe('export video: the dialog', () => {
  test('has an Image tab and a Video tab; the top bar button opens on the image', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await exportButton(page).click()
    await expect(dialog(page)).toBeVisible()
    await expect(page.getByRole('tablist', { name: 'What to export' })).toBeVisible()
    await expect(imageTab(page)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('export-download')).toBeVisible()
    await expect(page.getByTestId('video-panel')).toHaveCount(0)

    await videoTab(page).click()
    await expect(videoTab(page)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('video-panel')).toBeVisible()
    await expect(render(page)).toBeVisible()
    await expect(page.getByTestId('export-download')).toHaveCount(0) // the footer holds the tab's own buttons
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'export-tab-video')

    // Back to the picture: its preview is drawn again.
    await imageTab(page).click()
    await expect(page.getByTestId('export-preview')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })
    await expect(page.getByTestId('export-download')).toBeEnabled()
  })

  test('the tabs work from the keyboard', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await exportButton(page).click()
    await imageTab(page).focus()
    await page.keyboard.press('ArrowRight')
    await expect(videoTab(page)).toHaveAttribute('aria-selected', 'true')
    await expect(videoTab(page)).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(imageTab(page)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('End')
    await expect(videoTab(page)).toBeFocused()
    await page.keyboard.press('Home')
    await expect(imageTab(page)).toBeFocused()
  })

  test('the ride\'s "Record video" button opens the dialog on the Video tab, pauses the ride and gives the focus back', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await page.getByTestId('ride-button').click()
    await expect(page.getByTestId('ride-hud')).toBeVisible()
    expect(await page.evaluate(() => window.__ROADMAP__!.ride!.store.getState().playing)).toBe(true)

    await page.getByTestId('ride-record').click()
    await expect(dialog(page)).toBeVisible()
    await expect(videoTab(page)).toHaveAttribute('aria-selected', 'true')
    await expectPreviewReady(page)
    expect(await page.evaluate(() => window.__ROADMAP__!.ride!.store.getState().playing)).toBe(false)

    // Escape closes the dialog only (the ride stays), and the focus is back on the button that opened it.
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(page.getByTestId('ride-hud')).toBeVisible()
    await expect(page.getByTestId('ride-record')).toBeFocused()

    // The top bar button still opens the Image tab.
    await exportButton(page).click()
    await expect(imageTab(page)).toHaveAttribute('aria-selected', 'true')
  })

  test('has nothing to render for fewer than two places, and says why while a leg is still being routed', async ({ page, app, mocks }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await exportButton(page).click()
    await videoTab(page).click()
    await expect(page.getByTestId('video-empty')).toBeVisible()
    await expect(render(page)).toBeDisabled()
    await page.keyboard.press('Escape')

    mocks.osrm.delayMs = 4000
    await app.addPlaces('Annecy')
    await exportButton(page).click()
    await videoTab(page).click()
    await expect(render(page)).toBeDisabled()
    await expect(page.getByTestId('video-notes')).toContainText('still loading')
    mocks.osrm.delayMs = 0
    await expect(render(page)).toBeEnabled({ timeout: 15_000 })
  })

  test('shows the choices: sizes, lengths, camera, what to show, and the credit to post with the video', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await openVideoTab(page)
    for (const [id, size] of [['landscape', '1920 × 1080'], ['square', '1080 × 1080'], ['vertical', '1080 × 1920'], ['hd', '1280 × 720']] as const) {
      await expect(page.getByTestId(`video-preset-${id}`)).toContainText(size)
    }
    await expect(page.getByTestId('video-preset-landscape').getByRole('radio')).toBeChecked()
    for (const name of ['15 s', '30 s', '60 s', 'Ride pace']) await expect(page.getByRole('radio', { name, exact: true })).toBeVisible()
    await expect(page.getByRole('radio', { name: '30 s' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('radio', { name: 'Whole trip' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('radio', { name: 'Follow' })).toBeVisible()
    for (const id of ['card', 'labels', 'legend']) await expect(page.getByTestId(`video-toggle-${id}`)).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Match app' })).toBeVisible()
    await expect(page.getByTestId('video-summary')).toContainText('1920 × 1080 px · 0:30 · MP4 (H.264)')
    await expect(page.getByTestId('video-caption-text')).toHaveText('Map © OpenStreetMap — openstreetmap.org/copyright')

    // The length follows the choice; the legend needs two kinds of travel.
    await page.getByRole('radio', { name: '60 s' }).click()
    await expect(page.getByTestId('video-summary')).toContainText('1:00')
    await expect(page.getByTestId('video-toggle-legend')).toBeDisabled()
  })

  test('remembers what was chosen, across reloads', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openVideoTab(page)
    await page.getByTestId('video-preset-vertical').click()
    await page.getByRole('radio', { name: '15 s' }).click()
    await page.getByRole('radio', { name: 'Follow' }).click()
    await page.getByTestId('video-toggle-card').click()
    await page.getByRole('radio', { name: 'Dark', exact: true }).click()
    expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), OPTIONS_KEY)) as string)).toEqual({
      preset: 'vertical',
      length: '15',
      camera: 'follow',
      card: false,
      labels: true,
      legend: true,
      cardStyle: 'dark',
    })

    await page.reload()
    await app.ready()
    await exportButton(page).click()
    await videoTab(page).click()
    await expect(page.getByTestId('video-preset-vertical').getByRole('radio')).toBeChecked()
    await expect(page.getByRole('radio', { name: '15 s' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('radio', { name: 'Follow' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('video-toggle-card')).not.toBeChecked()
    await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toHaveAttribute('aria-checked', 'true')
  })

  test('ignores damaged saved choices', async ({ page, app }) => {
    await app.goto()
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ preset: 'cinema', length: 99, camera: 'orbit', card: 'no' })), OPTIONS_KEY)
    await page.reload()
    await app.ready()
    await app.addPlaces('Lyon', 'Annecy')
    await exportButton(page).click()
    await videoTab(page).click()
    await expect(page.getByTestId('video-preset-landscape').getByRole('radio')).toBeChecked()
    await expect(page.getByRole('radio', { name: '30 s' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('radio', { name: 'Whole trip' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('video-toggle-card')).toBeChecked()
  })
})

test.describe('export video: the preview', () => {
  test('is a frame of the video, with a slider to look at any moment of it', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await openVideoTab(page)
    const box = await preview(page).evaluate((c: HTMLCanvasElement) => ({ width: c.width, height: c.height }))
    expect(box.width / box.height).toBeCloseTo(16 / 9, 2)

    await scrubTo(page, 0)
    const start = await previewImage(page)
    await expect(page.getByTestId('video-frame-caption')).toContainText('Starting in Lyon')
    await scrubTo(page, 500)
    const middle = await previewImage(page)
    await expect(page.getByTestId('video-frame-caption')).toContainText('→')
    await scrubTo(page, 1000)
    const end = await previewImage(page)
    await expect(page.getByTestId('video-frame-caption')).toContainText('Arrived in Zurich')
    expect(new Set([start, middle, end]).size).toBe(3)
  })

  test('carries the OpenStreetMap credit at the start and on the end hold, and not while the map moves', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await openVideoTab(page)
    await scrubTo(page, 0)
    expect(await darkIn(page, 'credit')).toBeGreaterThan(80)
    await scrubTo(page, 500)
    expect(await darkIn(page, 'credit')).toBe(0)
    await scrubTo(page, 1000)
    expect(await darkIn(page, 'credit')).toBeGreaterThan(80)
  })

  test('shows the title card on the whole trip, and drops it when the switch is off', async ({ page, app }) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    await openVideoTab(page)
    await scrubTo(page, 500)
    expect(await darkIn(page, 'card')).toBeGreaterThan(2000) // the card's white plate
    await page.getByTestId('video-toggle-card').click()
    await expectPreviewReady(page)
    await scrubTo(page, 500)
    expect(await darkIn(page, 'card')).toBe(0)
  })

  test('follows the vehicle with a closer camera, and holds the whole trip, card included, at the start', async ({ page, app }) => {
    await openTrip(page, app, 'Paris', 'Lyon', 'Zurich', 'Vienna')
    await openVideoTab(page)
    await scrubTo(page, 500)
    const whole = await previewImage(page)
    await page.getByRole('radio', { name: 'Follow' }).click()
    await expectPreviewReady(page)
    await scrubTo(page, 500)
    expect(await previewImage(page)).not.toBe(whole)
    expect(await darkIn(page, 'card')).toBe(0) // out of the way while the camera is close
    await scrubTo(page, 0)
    expect(await darkIn(page, 'card')).toBeGreaterThan(2000) // back on the whole trip
  })
})

test.describe('export video: a frame through the same code as the render', () => {
  test('draws the start, the middle and the end of the ride, and saves them as pictures', async ({ page, app }, testInfo) => {
    await openTrip(page, app, 'Lyon', 'Annecy', 'Zurich')
    const frames = [] as { at: number; dataUrl: string; info: { phase: string; caption: string; follow: number }; width: number; height: number; camera: string }[]
    for (const at of [0, 0.5, 1]) {
      const frame = await page.evaluate((t) => window.__ROADMAP__!.video!.frame(t, { camera: 'whole', preset: 'landscape' }), at)
      frames.push({ at, ...frame })
      await testInfo.attach(`frame-${at}.png`, { body: Buffer.from(frame.dataUrl.split(',')[1], 'base64'), contentType: 'image/png' })
    }
    expect(frames.map((f) => [f.width, f.height])).toEqual([[1920, 1080], [1920, 1080], [1920, 1080]])
    expect(frames.map((f) => f.info.phase)).toEqual(['intro', 'ride', 'end'])
    expect(frames[0].info.caption).toBe('Starting in Lyon')
    expect(frames[2].info.caption).toBe('Arrived in Zurich')

    // The pictures are real: PNG files of the right size, different from each other.
    const decoded = await page.evaluate(async (urls) => {
      const out: { width: number; height: number; credit: number; blue: number; green: number }[] = []
      for (const url of urls) {
        const image = new Image()
        image.src = url
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(image, 0, 0)
        const count = (x0: number, y0: number, x1: number, y1: number, test: (r: number, g: number, b: number) => boolean) => {
          const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0)
          let n = 0
          for (let i = 0; i < data.length; i += 4) if (test(data[i], data[i + 1], data[i + 2])) n++
          return n
        }
        out.push({
          width: image.width,
          height: image.height,
          credit: count(1500, 1040, 1920, 1080, (r, g, b) => r + g + b < 300),
          blue: count(0, 0, 1920, 1080, (r, g, b) => Math.abs(r - 26) < 12 && Math.abs(g - 115) < 12 && Math.abs(b - 232) < 12),
          green: count(0, 0, 1920, 1080, (r, g, b) => r < 60 && g > 140 && b < 110 && g > r + 80),
        })
      }
      return out
    }, frames.map((f) => f.dataUrl))
    expect(decoded.map((d) => [d.width, d.height])).toEqual([[1920, 1080], [1920, 1080], [1920, 1080]])
    // The credit is in the first and the last frame, in the corner, and not in the middle one.
    expect(decoded[0].credit).toBeGreaterThan(150)
    expect(decoded[1].credit).toBe(0)
    expect(decoded[2].credit).toBeGreaterThan(150)
    // The trail grows: more emphasised route on screen as the ride goes on, and the stops turn green.
    expect(decoded[0].blue).toBeLessThan(decoded[1].blue)
    expect(decoded[1].blue).toBeLessThan(decoded[2].blue)
    expect(decoded[0].green).toBeLessThan(decoded[2].green)
  })

  test('a following camera makes a bigger background and keeps within the tile caps and concurrency', async ({ page, app, mocks }) => {
    test.setTimeout(60_000)
    await openTrip(page, app, 'Paris', 'Lyon', 'Zurich', 'Vienna', 'Prague')
    await app.settle()
    mocks.tiles.delayMs = 20
    mocks.tiles.peak = 0
    const before = new Set(mocks.tiles.urls)
    const frame = await page.evaluate(() => window.__ROADMAP__!.video!.frame(0.5, { camera: 'follow', preset: 'landscape' }))
    expect(frame.camera).toBe('follow')
    const fresh = new Set(mocks.tiles.urls.filter((u) => !before.has(u)))
    expect(frame.tiles.total).toBeGreaterThan(40) // a big background…
    expect(frame.tiles.total).toBeLessThanOrEqual(300) // …within the cap
    expect(fresh.size).toBeLessThanOrEqual(300)
    expect(mocks.tiles.peak).toBeLessThanOrEqual(6)
    // The map is fetched once for the whole video, not per frame: drawing every frame of it asks for nothing more.
    const requests = mocks.tiles.requests
    await page.evaluate(async () => {
      for (const at of [0.1, 0.4, 0.8, 1]) await window.__ROADMAP__!.video!.frame(at, { camera: 'follow', preset: 'landscape' })
    })
    expect(mocks.tiles.requests - requests).toBeLessThanOrEqual(frame.tiles.total - 100) // tiles kept in memory are not asked for again
  })

  test('draws the ferry on a ferry stretch', async ({ page, app }, testInfo) => {
    await openTrip(page, app, 'Hirtshals', 'Kristiansand')
    await page.evaluate(() => {
      const store = window.__ROADMAP__!.trip
      store.getState().updateLeg(store.getState().trip.legs[0].id, { mode: 'ferry' })
    })
    const frame = await page.evaluate(() => window.__ROADMAP__!.video!.frame(0.5, { camera: 'whole', preset: 'square' }))
    await testInfo.attach('ferry.png', { body: Buffer.from(frame.dataUrl.split(',')[1], 'base64'), contentType: 'image/png' })
    expect(frame.info.caption).toBe('Hirtshals → Kristiansand')
    expect([frame.width, frame.height]).toEqual([1080, 1080])
  })
})

test.describe('export video: rendering', () => {
  test('renders an MP4 of the right size and length, with a progress bar and a time estimate, and downloads it', async ({ page, app }) => {
    test.slow() // a 240-frame render: seconds on a quiet machine, much more beside another test run
    await openTrip(page, app, 'Lyon', 'Annecy')
    await app.page.evaluate(() => window.__ROADMAP__!.trip.getState().setTitle('Alps: Lyon → Annecy!'))
    await openVideoTab(page)
    await page.getByTestId('video-preset-hd').click()
    await page.getByRole('radio', { name: 'Ride pace' }).click()
    await expectPreviewReady(page)
    await expect(page.getByTestId('video-summary')).toContainText('1280 × 720 px · 0:08')

    await render(page).click()
    // Progress: the bar, the step, the time left; the other tab and the render button are not available meanwhile.
    await expect(page.getByTestId('video-progress')).toBeVisible()
    await expect(cancel(page)).toBeVisible()
    await expect(imageTab(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByTestId('video-progress-text')).toContainText(/Rendering frame \d+ of 240/, { timeout: 30_000 })
    // The bar is read from inside the page, every 100 ms until it goes away (one call, not one for every look: on a loaded machine each call can take a second).
    const seen = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const values: number[] = []
          const started = performance.now()
          const look = () => {
            const bar = document.querySelector('[role=progressbar][aria-label="Video progress"]')
            if (!bar || performance.now() - started > 90_000) return resolve(values)
            values.push(Number(bar.getAttribute('aria-valuenow')))
            setTimeout(look, 100)
          }
          look()
        }),
    )
    await expect(downloadButton(page)).toBeVisible({ timeout: 90_000 })
    expect(seen.length).toBeGreaterThan(0)
    expect(Math.max(...seen)).toBeGreaterThan(0)
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true)

    await expect(outcome(page)).toContainText('Video ready: 1280 × 720 px, 0:08')
    await expect(outcome(page)).toContainText('MP4')
    await expect(imageTab(page)).not.toHaveAttribute('aria-disabled', 'true')
    const [d] = await Promise.all([page.waitForEvent('download'), downloadButton(page).click()])
    const file = await saved(d)
    expect(d.suggestedFilename()).toBe('alps-lyon-annecy-ride.mp4')

    // A real MP4 of the size and length chosen: 8 s at 30 frames a second.
    expect(file.subarray(4, 8).toString('ascii')).toBe('ftyp')
    expect(file.length).toBeGreaterThan(20_000)
    expect(file.length).toBeLessThan(40_000_000)
    const mp4 = readMp4(file)
    expect(mp4).toMatchObject({ width: 1280, height: 720 })
    expect(mp4.seconds).toBeCloseTo(8, 1)
    expect(mp4.brands).toMatch(/^(isom|mp4|iso)/)
  })

  test('shows the finished video in the preview, and goes back to the preview when a choice changes', async ({ page, app }) => {
    test.setTimeout(120_000)
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openVideoTab(page)
    await page.getByTestId('video-preset-hd').click()
    await page.getByRole('radio', { name: 'Ride pace' }).click()
    await render(page).click()
    await expect(downloadButton(page)).toBeVisible({ timeout: 90_000 })
    await expect(page.getByTestId('video-player')).toBeVisible()
    await expect(preview(page)).toHaveCount(0)

    await page.getByRole('radio', { name: 'Follow' }).click()
    await expect(page.getByTestId('video-player')).toHaveCount(0)
    await expect(downloadButton(page)).toHaveCount(0)
    await expect(render(page)).toBeVisible()
    await expectPreviewReady(page)
    // The preview comes back drawn, not blank.
    await scrubTo(page, 0)
    expect(await darkIn(page, 'card')).toBeGreaterThan(2000)
  })

  test('cancels: the render stops, nothing is downloaded, and rendering again works', async ({ page, app }) => {
    test.setTimeout(120_000)
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openVideoTab(page)
    await page.getByTestId('video-preset-hd').click()
    await page.getByRole('radio', { name: '60 s' }).click()
    await expectPreviewReady(page)
    const downloads: string[] = []
    page.on('download', (d) => downloads.push(d.suggestedFilename()))

    await render(page).click()
    await expect(page.getByTestId('video-progress-text')).toContainText('Rendering frame', { timeout: 30_000 })
    await expect(page.getByTestId('video-progress-eta')).toContainText(/left|Estimating/)
    await cancel(page).click()
    await expect(page.getByTestId('video-progress')).toHaveCount(0)
    await expect(outcome(page)).toContainText('Cancelled')
    await expect(render(page)).toBeEnabled()
    await expect(imageTab(page)).not.toHaveAttribute('aria-disabled', 'true')
    await page.waitForTimeout(500)
    expect(downloads).toEqual([])
    expect(await page.evaluate(() => (document.querySelector('[data-testid=video-progress-text]') ? 1 : 0))).toBe(0)

    // The encoder was let go cleanly: a new render (a short one) works.
    await page.getByRole('radio', { name: 'Ride pace' }).click()
    const { file } = await renderAndDownload(page)
    expect(file.subarray(4, 8).toString('ascii')).toBe('ftyp')
  })

  test('closing the dialog stops the render and starts no more tile requests', async ({ page, app, mocks }) => {
    test.setTimeout(60_000)
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openVideoTab(page)
    await page.getByTestId('video-preset-hd').click()
    await page.getByRole('radio', { name: '60 s' }).click()
    await expectPreviewReady(page)
    const downloads: string[] = []
    page.on('download', (d) => downloads.push(d.suggestedFilename()))
    await render(page).click()
    await expect(page.getByTestId('video-progress-text')).toContainText('Rendering frame', { timeout: 30_000 })
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    const requests = mocks.tiles.requests
    await page.waitForTimeout(1500)
    expect(mocks.tiles.requests).toBe(requests)
    expect(downloads).toEqual([])
    // Nothing keeps running: the page is still responsive and a new dialog renders as before.
    await exportButton(page).click()
    await videoTab(page).click()
    await expectPreviewReady(page)
    await expect(render(page)).toBeEnabled()
  })

  test('renders a video with a following camera, end to end', async ({ page, app }) => {
    test.setTimeout(150_000)
    await openTrip(page, app, 'Paris', 'Lyon', 'Zurich')
    await openVideoTab(page)
    await page.getByTestId('video-preset-hd').click()
    await page.getByRole('radio', { name: 'Ride pace' }).click()
    await page.getByRole('radio', { name: 'Follow' }).click()
    await expectPreviewReady(page)
    // The camera really follows (it did not fall back to the whole trip), and the summary has the length.
    await expect(page.getByTestId('video-notes')).toHaveCount(0)
    expect((await page.evaluate(() => window.__ROADMAP__!.video!.frame(0.5, { camera: 'follow', preset: 'hd' }))).camera).toBe('follow')
    await expect(page.getByTestId('video-summary')).toContainText('1280 × 720 px · 0:10')

    const { file, name } = await renderAndDownload(page)
    expect(name).toMatch(/-ride\.mp4$/)
    expect(file.subarray(4, 8).toString('ascii')).toBe('ftyp')
    const mp4 = readMp4(file)
    expect(mp4).toMatchObject({ width: 1280, height: 720 })
    expect(mp4.seconds).toBeCloseTo(9.6, 1) // two travel days (2 × 2.5 s) and the first, resting day (0.6 s) at the ride's pace, and the 4 s of holds
    expect(file.length).toBeGreaterThan(20_000)
    await expect(outcome(page)).toContainText('Video ready: 1280 × 720 px, 0:10')
  })

  test('keeps a finished video when the routes or the statistics are worked out again behind it, until a choice changes', async ({ page, app }) => {
    test.setTimeout(120_000)
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openVideoTab(page)
    await page.getByTestId('video-preset-hd').click()
    await page.getByRole('radio', { name: 'Ride pace' }).click()
    await render(page).click()
    await expect(downloadButton(page)).toBeVisible({ timeout: 90_000 })
    const src = await page.getByTestId('video-player').getAttribute('src')

    // A late route, a recomputed statistic: new objects everywhere, nothing the user chose.
    await page.evaluate(() => window.__ROADMAP__!.routes.setState((s) => ({ errors: { ...s.errors } })))
    await page.waitForTimeout(1200)
    await expect(downloadButton(page)).toBeVisible()
    await expect(page.getByTestId('video-player')).toHaveAttribute('src', src as string)
    await expect(outcome(page)).toContainText('Video ready')
    const [d] = await Promise.all([page.waitForEvent('download'), downloadButton(page).click()])
    expect((await saved(d)).subarray(4, 8).toString('ascii')).toBe('ftyp')

    // A choice does take it away, and the next render makes a new one.
    await page.getByTestId('video-toggle-labels').click()
    await expect(downloadButton(page)).toHaveCount(0)
    await expect(render(page)).toBeVisible()
  })

  test('makes a WebM (VP9) where the browser has no H.264 encoder', async ({ page, app }) => {
    test.setTimeout(120_000)
    await page.addInitScript(() => {
      const original = VideoEncoder.isConfigSupported.bind(VideoEncoder)
      VideoEncoder.isConfigSupported = (config) => (config.codec?.startsWith('avc1') ? Promise.resolve({ supported: false, config }) : original(config))
    })
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openVideoTab(page)
    await page.getByTestId('video-preset-hd').click()
    await page.getByRole('radio', { name: 'Ride pace' }).click()
    await expect(page.getByTestId('video-summary')).toContainText('WebM (VP9)')
    const { file, name } = await renderAndDownload(page)
    expect(name).toMatch(/-ride\.webm$/)
    expect(isWebm(file)).toBe(true)
    expect(file.length).toBeGreaterThan(10_000)
  })

  test('records the canvas, in real time, in a browser without WebCodecs', async ({ page, app }) => {
    test.setTimeout(120_000)
    await page.addInitScript(() => {
      delete (window as { VideoEncoder?: unknown }).VideoEncoder
      // Let MediaRecorder make WebM, whatever else Chromium offers.
      const supported = MediaRecorder.isTypeSupported.bind(MediaRecorder)
      MediaRecorder.isTypeSupported = (type) => !type.startsWith('video/mp4') && supported(type)
    })
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openVideoTab(page)
    await page.getByTestId('video-preset-hd').click()
    await page.getByRole('radio', { name: 'Ride pace' }).click()
    await expect(page.getByTestId('video-summary')).toContainText('recorded in real time')
    await expect(page.getByTestId('video-notes')).toContainText('real time')
    const t0 = Date.now()
    const { file } = await renderAndDownload(page)
    expect(Date.now() - t0).toBeGreaterThan(6_500) // 8 s of video takes about 8 s
    expect(isWebm(file)).toBe(true)
    expect(file.length).toBeGreaterThan(10_000)
  })

  test('says so when the browser cannot make a video at all', async ({ page, app }) => {
    await page.addInitScript(() => {
      delete (window as { VideoEncoder?: unknown }).VideoEncoder
      delete (window as { MediaRecorder?: unknown }).MediaRecorder
    })
    await openTrip(page, app, 'Lyon', 'Annecy')
    await exportButton(page).click()
    await videoTab(page).click()
    await expect(page.getByTestId('video-notes')).toContainText('cannot make videos')
    await expect(render(page)).toBeDisabled()
  })

  test('offers to share the finished video where the browser can share files', async ({ page, app }) => {
    test.setTimeout(120_000)
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { value: (data: { files?: File[] }) => (data.files?.length ?? 0) > 0, configurable: true })
      Object.defineProperty(navigator, 'share', {
        value: async (data: { files?: File[]; title?: string; text?: string }) => {
          ;(window as unknown as { __shared: unknown }).__shared = { files: data.files?.map((f) => ({ name: f.name, type: f.type, size: f.size })), title: data.title, text: data.text }
        },
        configurable: true,
      })
    })
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openVideoTab(page)
    await page.getByTestId('video-preset-hd').click()
    await page.getByRole('radio', { name: 'Ride pace' }).click()
    await expect(page.getByTestId('video-share')).toHaveCount(0)
    await render(page).click()
    await expect(page.getByTestId('video-share')).toBeVisible({ timeout: 90_000 })
    await page.getByTestId('video-share').click()
    const shared = await page.evaluate(() => (window as unknown as { __shared: { files: { name: string; type: string; size: number }[]; title: string; text: string } }).__shared)
    expect(shared.files).toHaveLength(1)
    expect(shared.files[0].name).toMatch(/-ride\.mp4$/)
    expect(shared.files[0].type).toBe('video/mp4')
    expect(shared.files[0].size).toBeGreaterThan(10_000)
    expect(shared.text).toContain('openstreetmap.org/copyright') // the credit goes with it
  })

  test('has the credit in the video itself: at the start and on the end hold, not in between', async ({ page, app }) => {
    test.setTimeout(150_000)
    // A WebM, because that is what this browser can play back to look at its frames.
    await page.addInitScript(() => {
      const original = VideoEncoder.isConfigSupported.bind(VideoEncoder)
      VideoEncoder.isConfigSupported = (config) => (config.codec?.startsWith('avc1') ? Promise.resolve({ supported: false, config }) : original(config))
    })
    await openTrip(page, app, 'Lyon', 'Annecy')
    await openVideoTab(page)
    await page.getByTestId('video-preset-hd').click()
    await page.getByRole('radio', { name: '15 s' }).click()
    await render(page).click()
    await expect(downloadButton(page)).toBeVisible({ timeout: 120_000 })

    const credit = await page.getByTestId('video-player').evaluate(async (video: HTMLVideoElement) => {
      await new Promise<void>((resolve) => (video.readyState >= 2 ? resolve() : video.addEventListener('loadeddata', () => resolve(), { once: true })))
      const canvas = document.createElement('canvas')
      const dark: Record<string, number> = {}
      for (const t of [0.5, 2, 8, 13.5, 14.8]) {
        await new Promise<void>((resolve) => {
          video.addEventListener('seeked', () => resolve(), { once: true })
          video.currentTime = t
        })
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(video, 0, 0)
        const { data } = ctx.getImageData(canvas.width - 380, canvas.height - 40, 380, 40)
        let count = 0
        for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 250) count++
        dark[String(t)] = count
      }
      return { size: [video.videoWidth, video.videoHeight], dark }
    })
    expect(credit.size).toEqual([1280, 720])
    expect(credit.dark['0.5']).toBeGreaterThan(100)
    expect(credit.dark['2']).toBeGreaterThan(100)
    expect(credit.dark['8']).toBe(0)
    expect(credit.dark['13.5']).toBeGreaterThan(100)
    expect(credit.dark['14.8']).toBeGreaterThan(100)
  })
})

test.describe('export video: long and tiny trips', () => {
  test('caps a long trip at two minutes: the dialog says so and a real render is that long', async ({ page, app }) => {
    test.setTimeout(240_000)
    await app.goto()
    // Sixty stops on train legs (no routing to wait for), a day apart: 59 travel days, a ride of 147 s at its own pace.
    await page.evaluate(() => {
      const store = window.__ROADMAP__!.trip
      for (let i = 0; i < 60; i++) store.getState().addPlace({ name: `Stop ${i + 1}`, lat: 41 + 6 * Math.sin(i / 6), lng: -6 + i * 0.55 })
      for (const leg of store.getState().trip.legs) store.getState().updateLeg(leg.id, { mode: 'train' })
    })
    await exportButton(page).click()
    await videoTab(page).click()
    await page.getByRole('radio', { name: 'Ride pace' }).click()
    await expect(page.getByTestId('video-summary')).toContainText('· 2:00 ·')
    await expect(page.getByTestId('video-notes')).toContainText('sped up to 2:00')

    // The real thing at a small size: 3 600 frames, 120 seconds.
    const result = await page.evaluate(() => window.__ROADMAP__!.video!.render({ length: 'ride', camera: 'whole' }, undefined, { width: 320, height: 180 }))
    expect(result).toMatchObject({ width: 320, height: 180, frames: 3600, extension: 'mp4' })
    expect(result.duration).toBeCloseTo(120, 1)
    const file = Buffer.from(result.base64, 'base64')
    expect(file.subarray(4, 8).toString('ascii')).toBe('ftyp')
    const mp4 = readMp4(file)
    expect(mp4).toMatchObject({ width: 320, height: 180 })
    expect(mp4.seconds).toBeCloseTo(120, 1)
  })

  test('says why a trip too small to follow is shown whole: there is nothing to zoom in on', async ({ page, app }) => {
    await app.goto()
    // Two places a metre apart, joined by a train: the whole trip is already as close as the camera goes.
    await page.evaluate(() => {
      const store = window.__ROADMAP__!.trip
      store.getState().addPlace({ name: 'Here', lat: 45.0, lng: 5.0 })
      store.getState().addPlace({ name: 'There', lat: 45.00001, lng: 5.00001 })
      store.getState().updateLeg(store.getState().trip.legs[0].id, { mode: 'train' })
    })
    await exportButton(page).click()
    await videoTab(page).click()
    await page.getByRole('radio', { name: 'Follow' }).click()
    await expectPreviewReady(page)
    const notes = page.getByTestId('video-notes')
    await expect(notes).toContainText('nothing to follow')
    await expect(notes).not.toContainText('tiles')
    const frame = await page.evaluate(() => window.__ROADMAP__!.video!.frame(0.5, { camera: 'follow' }))
    expect(frame.camera).toBe('whole')
    expect(frame.cameraNote).toMatch(/nothing to follow/)
  })
})
