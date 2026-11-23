import { expect, test } from './fixtures'

test.describe('desktop layout', () => {
  test('the page itself never scrolls and the sidebar is a fixed 360px column', async ({ page, app }) => {
    await app.goto()
    const metrics = await page.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }))
    expect(metrics.scrollH).toBeLessThanOrEqual(metrics.innerH)
    expect(metrics.scrollW).toBeLessThanOrEqual(metrics.innerW)

    const sidebar = await page.getByTestId('sidebar').boundingBox()
    expect(sidebar?.width).toBe(360)
    // The mobile toggle is hidden on wide screens.
    await expect(page.getByTestId('sidebar-toggle')).toBeHidden()
  })
})

test.describe('mobile layout', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the sidebar is a slide-over toggled from the top bar', async ({ page, app }) => {
    await app.goto()
    const sidebar = page.getByTestId('sidebar')
    const toggle = page.getByTestId('sidebar-toggle')

    await expect(sidebar).toBeHidden()
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await toggle.click()
    await expect(sidebar).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect((await app.ui()).sidebarOpen).toBe(true)

    await page.keyboard.press('Escape')
    await expect(sidebar).toBeHidden()

    await toggle.click()
    await expect(sidebar).toBeVisible()
    // Tapping the dimmed map behind it closes it.
    await page.mouse.click(380, 400)
    await expect(sidebar).toBeHidden()

    await toggle.click()
    await page.getByRole('button', { name: 'Close places' }).click()
    await expect(sidebar).toBeHidden()
  })

  test('focus moves into the slide-over when it opens and back to the toggle when it closes', async ({ page, app }) => {
    await app.goto()
    const toggle = page.getByTestId('sidebar-toggle')
    const close = page.getByRole('button', { name: 'Close places' })

    await toggle.click()
    await expect(close).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(toggle).toBeFocused()

    await toggle.click()
    await expect(close).toBeFocused()
    await close.click()
    await expect(toggle).toBeFocused()

    // Closing by tapping the dimmed map also returns focus to the toggle.
    await toggle.click()
    await page.mouse.click(380, 400)
    await expect(toggle).toBeFocused()
  })

  test('the top bar keeps the title and the main actions in view and folds the rest into a menu', async ({ page, app }) => {
    await app.goto()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await expect(page.getByTestId('trip-title')).toBeVisible()
    await expect(page.getByTestId('ride-button')).toBeVisible()
    await expect(page.getByTestId('export-image-button')).toBeVisible()
    await expect(page.getByTestId('file-menu')).toBeVisible()
    await expect(page.getByTestId('topbar-overflow')).toBeVisible()
    // Undo, redo, presentation, help and the theme are in the overflow menu, not in the bar.
    for (const id of ['undo', 'redo', 'present-toggle', 'help-button', 'theme-toggle']) await expect(page.getByTestId(id)).toBeHidden()
    // Nothing in the bar sticks out of the screen.
    const bar = await page.locator('.topbar').evaluate((el) => [...el.querySelectorAll('button, input')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => [r.left, r.right]))
    for (const [left, right] of bar) {
      expect(left).toBeGreaterThanOrEqual(0)
      expect(right).toBeLessThanOrEqual(390)
    }

    await page.getByTestId('topbar-overflow').click()
    await expect(page.getByRole('menuitem', { name: 'Undo' })).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByRole('menuitem', { name: 'Redo' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Presentation mode' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Help and shortcuts' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Switch to dark mode' }).click()
    await expect.poll(async () => (await app.ui()).theme).toBe('dark')
  })

  test('undo and redo work from the overflow menu', async ({ page, app }) => {
    await app.goto()
    await app.addPlaces('Lyon')
    await page.getByTestId('topbar-overflow').click()
    await page.getByRole('menuitem', { name: 'Undo' }).click()
    expect((await app.trip()).places).toHaveLength(0)
    await page.getByTestId('topbar-overflow').click()
    await page.getByRole('menuitem', { name: 'Redo' }).click()
    expect((await app.trip()).places).toHaveLength(1)
  })
})

test.describe('wide screens', () => {
  test('the top bar shows every button and no overflow menu', async ({ page, app }) => {
    await app.goto()
    for (const id of ['undo', 'redo', 'ride-button', 'export-image-button', 'file-menu', 'present-toggle', 'help-button', 'theme-toggle']) {
      await expect(page.getByTestId(id)).toBeVisible()
    }
    await expect(page.getByTestId('topbar-overflow')).toBeHidden()
  })

  for (const width of [768, 900, 1024]) {
    test(`the top bar fits at ${width}px`, async ({ page, app }) => {
      await page.setViewportSize({ width, height: 800 })
      await app.goto()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      const box = (await page.getByTestId('trip-title').boundingBox())!
      expect(box.width).toBeGreaterThan(120)
      const last = (await page.getByTestId('theme-toggle').boundingBox())!
      expect(last.x + last.width).toBeLessThanOrEqual(width)
    })
  }
})
