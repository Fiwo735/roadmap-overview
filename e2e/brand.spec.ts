import type { Page } from '@playwright/test'
import { expect, STORAGE_KEYS, test } from './fixtures'

/**
 * The Vanagram identity (F17): the name in the page and the top bar, the logo as an image of the favicon asset, the icons, the
 * web manifest and the link-preview picture being served, and files made before the rename (as "Roadmap Overview") still opening.
 * The same files under a sub-path build are checked in `subpath.spec.ts`.
 */

/** A trip file exactly as the app wrote it before the rename: the historic format id, no routes. */
const OLD_FILE = {
  format: 'roadmap-overview/trip',
  version: 1,
  exportedAt: '2026-11-20T10:00:00.000Z',
  trip: {
    id: 't_old',
    title: 'Before the rename',
    places: [
      { id: 'p_a', name: 'Berlin', lat: 52.52, lng: 13.405, day: 0 },
      { id: 'p_b', name: 'Prague', lat: 50.0755, lng: 14.4378, day: 1, note: 'Old town first.' },
    ],
    legs: [{ id: 'l_a', fromId: 'p_a', toId: 'p_b', mode: 'drive', via: [] }],
  },
}

const attr = (page: Page, selector: string, name: string) => page.locator(selector).first().getAttribute(name)

test.describe('the name', () => {
  test('the document, the top bar and the description say Vanagram, and nothing says Roadmap Overview', async ({ page, app }) => {
    await app.goto()
    await expect(page).toHaveTitle('Vanagram — your campervan trip on one map')
    await expect(page.getByRole('banner')).toContainText('Vanagram')
    expect(await attr(page, 'meta[name="description"]', 'content')).toMatch(/campervan trip/)
    expect(await page.locator('head').innerHTML()).not.toMatch(/roadmap overview/i)
    expect((await page.locator('body').innerText()).toLowerCase()).not.toContain('roadmap overview')
  })

  test('the Help dialog names the app', async ({ page, app }) => {
    await app.goto()
    await page.getByTestId('help-button').click()
    await expect(page.getByTestId('help-dialog')).toBeVisible()
    await expect(page.getByRole('dialog')).toContainText('Vanagram sketches a campervan trip')
    expect(await page.getByRole('dialog').innerText()).not.toMatch(/roadmap overview/i)
  })

  test('the brand is live text in the app font beside the logo, and folds away on narrower screens as before', async ({ page, app }) => {
    await app.goto()
    const name = page.locator('.brand__name')
    await expect(name).toHaveText('Vanagram')
    expect(await name.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Inter/)
    await expect(page.locator('.brand .logo')).toBeVisible()
    expect((await name.boundingBox())!.width).toBeGreaterThan(50)

    // Below 1024 px the name makes room for the title; below 500 px the logo does too.
    await page.setViewportSize({ width: 800, height: 700 })
    expect((await name.boundingBox())!.width).toBeLessThanOrEqual(1)
    await expect(page.locator('.brand .logo')).toBeVisible()
    await page.setViewportSize({ width: 390, height: 800 })
    await expect(page.locator('.brand')).toBeHidden()
    await expect(page.getByTestId('trip-title')).toBeVisible()
  })

  test('a screen reader hears the name once wherever the logo shows: the logo is only a picture, the name is text that is merely taken out of sight', async ({ page, app }) => {
    await app.goto()
    const heard = async () => ((await page.getByRole('banner').ariaSnapshot()).match(/Vanagram/g) ?? []).length
    for (const width of [1440, 1024, 1023, 800, 600, 500]) {
      await page.setViewportSize({ width, height: 800 })
      await expect(page.locator('.brand .logo'), `logo at ${width}`).toBeVisible()
      expect(await heard(), `at ${width} px`).toBe(1)
      // The text is in the page (not display: none) whatever its size on screen.
      await expect(page.locator('.brand__name')).not.toHaveCSS('display', 'none')
    }
    // Below 500 px neither the logo nor the name is there, as before.
    await page.setViewportSize({ width: 499, height: 800 })
    await expect(page.locator('.brand')).toBeHidden()
    expect(await heard()).toBe(0)
  })
})

test.describe('the logo', () => {
  test('is an image of favicon.svg, so the browser picks the design that suits its size, and it loads', async ({ page, app }) => {
    await app.goto()
    const logo = page.locator('.brand img.logo')
    await expect(logo).toHaveAttribute('src', '/favicon.svg')
    await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    const box = await logo.boundingBox()
    expect(box?.width).toBe(32)
    expect(box?.height).toBe(32)
    // Decorative: the name is written beside it.
    await expect(logo).toHaveAttribute('alt', '')
  })

  test('is drawn as the 16 px pixel-grid design when small and the detailed one from 32 px: the same pixels as the PNGs made from it', async ({ page, app }) => {
    // Only an <img> (or a tab) gives the SVG its media query a viewport of the drawn size; a canvas would always show the big design.
    await app.goto()
    await page.evaluate(() => {
      const box = document.createElement('div')
      box.style.cssText = 'position:fixed;left:40px;top:300px;z-index:99999;background:#fff;padding:8px;display:flex;gap:8px;align-items:flex-start'
      box.innerHTML = [
        ['svg16', '/favicon.svg', 16],
        ['png16', '/favicon-16.png', 16],
        ['svg32', '/favicon.svg', 32],
        ['png32', '/favicon-32.png', 32],
        ['png32-at-16', '/favicon-32.png', 16],
      ]
        .map(([id, src, size]) => `<img id="${id}" src="${src}" width="${size}" height="${size}" alt="">`)
        .join('')
      document.body.append(box)
      return Promise.all([...box.querySelectorAll('img')].map((img) => img.decode()))
    })
    const shot = (id: string) => page.locator(`#${id}`).screenshot()
    expect((await shot('svg16')).equals(await shot('png16'))).toBe(true)
    expect((await shot('svg32')).equals(await shot('png32'))).toBe(true)
    // The 32 design shrunk to 16 px is a different picture from the one the SVG draws there.
    expect((await shot('svg16')).equals(await shot('png32-at-16'))).toBe(false)
  })
})

test.describe('icons, manifest and link preview', () => {
  test('every icon the page links is served, with the type and size it says', async ({ page, app }) => {
    await app.goto()
    const links = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"]').evaluateAll((els) =>
      els.map((el) => ({ rel: el.getAttribute('rel'), href: (el as HTMLLinkElement).href, type: el.getAttribute('type'), sizes: el.getAttribute('sizes') })),
    )
    expect(links.map((l) => new URL(l.href).pathname)).toEqual(['/favicon-32.png', '/favicon-16.png', '/favicon.svg', '/apple-touch-icon.png'])
    for (const link of links) {
      const response = await page.request.get(link.href)
      expect(response.status(), link.href).toBe(200)
      const contentType = response.headers()['content-type'] ?? ''
      if (link.type) expect(contentType).toContain(link.type)
      const sized = /^(\d+)x\1$/.exec(link.sizes ?? '')
      if (sized) {
        const bytes = await response.body()
        expect(bytes.readUInt32BE(16)).toBe(Number(sized[1]))
        expect(bytes.readUInt32BE(20)).toBe(Number(sized[1]))
      }
    }
    // iOS: a 180 px PNG that is a full square (it adds its own corners).
    const apple = await page.request.get('/apple-touch-icon.png')
    expect((await apple.body()).readUInt32BE(16)).toBe(180)
  })

  test('the web manifest parses, names Vanagram and its icons (one maskable) are served', async ({ page, app }) => {
    await app.goto()
    const href = await page.locator('link[rel="manifest"]').evaluate((el) => (el as HTMLLinkElement).href)
    const response = await page.request.get(href)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toMatch(/manifest\+json|application\/json/)
    const manifest = (await response.json()) as {
      name: string
      short_name: string
      display: string
      theme_color: string
      background_color: string
      start_url: string
      scope: string
      icons: { src: string; sizes: string; type: string; purpose?: string }[]
    }
    expect(manifest).toMatchObject({ name: 'Vanagram', short_name: 'Vanagram', display: 'standalone', theme_color: '#1a73e8' })
    // Relative to the manifest's own address: the start page is where the manifest sits, wherever the app is hosted.
    expect(new URL(manifest.start_url, href).pathname).toBe('/')
    expect(new URL(manifest.scope, href).pathname).toBe('/')
    expect(manifest.icons.filter((i) => i.purpose === 'maskable')).toHaveLength(1)
    expect(manifest.icons.some((i) => i.sizes === '192x192')).toBe(true)
    expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true)
    for (const icon of manifest.icons) {
      const icons = await page.request.get(new URL(icon.src, href).href)
      expect(icons.status(), icon.src).toBe(200)
      expect(icons.headers()['content-type']).toBe(icon.type)
      const size = Number(icon.sizes.split('x')[0])
      const bytes = await icons.body()
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([size, size])
    }
  })

  test('the link preview has a title, a description, a card type and a served 1200 × 630 picture', async ({ page, app }) => {
    await app.goto()
    expect(await attr(page, 'meta[property="og:title"]', 'content')).toBe('Vanagram — your campervan trip on one map')
    expect(await attr(page, 'meta[property="og:type"]', 'content')).toBe('website')
    expect(await attr(page, 'meta[property="og:site_name"]', 'content')).toBe('Vanagram')
    expect(await attr(page, 'meta[property="og:description"]', 'content')).toBeTruthy()
    expect(await attr(page, 'meta[name="twitter:card"]', 'content')).toBe('summary_large_image')
    expect(await attr(page, 'meta[name="twitter:title"]', 'content')).toBe('Vanagram — your campervan trip on one map')

    // No VITE_SITE_URL in the dev server: a path (the absolute form is in subpath.spec.ts).
    const image = await attr(page, 'meta[property="og:image"]', 'content')
    expect(image).toBe('/og-image.png')
    expect(await attr(page, 'meta[name="twitter:image"]', 'content')).toBe(image)
    const response = await page.request.get(image!)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('image/png')
    const bytes = await response.body()
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1200, 630])
  })

})

/** The theme-color metas as [media, colour] pairs. */
const themeColors = (page: Page) =>
  page.locator('meta[name="theme-color"]').evaluateAll((els) => els.map((el) => [el.getAttribute('media'), el.getAttribute('content')]))
const LIGHT = ['(prefers-color-scheme: light)', '#ffffff']
const DARK = ['(prefers-color-scheme: dark)', '#161d28']
const BOTH_LIGHT = [LIGHT, ['(prefers-color-scheme: dark)', '#ffffff']]
const BOTH_DARK = [['(prefers-color-scheme: light)', '#161d28'], DARK]

test.describe('the address-bar colour follows the theme', () => {
  test('there is a colour for each OS scheme while the app follows the OS', async ({ page, app }) => {
    await app.goto()
    expect(await themeColors(page)).toEqual([LIGHT, DARK])
  })

  test('a theme picked in the app tints both metas, whatever the OS says, and keeps doing so after a reload', async ({ page, app }) => {
    await app.goto()
    await page.getByTestId('theme-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await themeColors(page)).toEqual(BOTH_DARK)

    await page.reload()
    await app.ready()
    expect(await themeColors(page)).toEqual(BOTH_DARK)

    await page.getByTestId('theme-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(await themeColors(page)).toEqual(BOTH_LIGHT)
  })

  test('the page script alone (before the app starts) already applies a stored choice', async ({ page, app }) => {
    await app.seedRawStorage(STORAGE_KEYS.theme, 'dark')
    await page.route('**/src/main.tsx', (route) => route.abort())
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await themeColors(page)).toEqual(BOTH_DARK)
  })

  test.describe('on a dark OS', () => {
    test.use({ colorScheme: 'dark' })

    test('the metas are untouched until the user picks a theme, and then follow the pick', async ({ page, app }) => {
      await app.goto()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      expect(await themeColors(page)).toEqual([LIGHT, DARK])

      await page.getByTestId('theme-toggle').click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
      expect(await themeColors(page)).toEqual(BOTH_LIGHT)
    })

    test('a light theme stored from an earlier visit tints the bar light', async ({ page, app }) => {
      await app.seedRawStorage(STORAGE_KEYS.theme, 'light')
      await app.goto()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
      expect(await themeColors(page)).toEqual(BOTH_LIGHT)
    })
  })
})

test.describe('trips made before the rename', () => {
  test('a file in the historic format opens, routes and all', async ({ page, app }) => {
    await app.goto()
    await page.getByTestId('file-menu').click()
    const choosing = page.waitForEvent('filechooser')
    await page.getByRole('menuitem', { name: 'Open trip file…' }).click()
    await (await choosing).setFiles({ name: 'before.trip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(OLD_FILE)) })

    await expect(page.getByTestId('trip-title')).toHaveValue('Before the rename')
    await expect(page.getByTestId('place-item')).toHaveCount(2)
    await expect(page.getByTestId('toast').last()).toContainText('Opened “Before the rename” (2 places).')
    await expect(page.getByTestId('leg-connector').first()).toHaveAttribute('data-status', 'ok')
    // What it writes back is still the historic format, so older copies of the app (and links) keep working.
    await expect.poll(async () => (await app.savedFile())?.format).toBe('roadmap-overview/trip')
  })

  test('an autosave from before the rename is restored on start (the storage key did not change)', async ({ page, app }) => {
    await app.seedRawStorage(STORAGE_KEYS.trip, JSON.stringify(OLD_FILE))
    await app.goto()
    await expect(page.getByTestId('trip-title')).toHaveValue('Before the rename')
    await expect(page.getByTestId('place-item')).toHaveCount(2)
  })

  test('the bundled sample, made before the rename, opens', async ({ page, app }) => {
    await app.goto()
    await page.getByTestId('file-menu').click()
    await page.getByRole('menuitem', { name: 'Load sample trip' }).click()
    await expect(page.getByTestId('place-item')).toHaveCount(12)
    expect(await attr(page, 'meta[property="og:title"]', 'content')).toContain('Vanagram')
  })
})
