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

  test('the top bar keeps title and undo/redo reachable without overflowing', async ({ page, app }) => {
    await app.goto()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await expect(page.getByTestId('trip-title')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
    await expect(page.getByTestId('theme-toggle')).toBeVisible()
  })
})
