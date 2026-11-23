import { expect, test } from './fixtures'

// Exercises the shared UI components on the dev-only /ui-kit.html page.

test.beforeEach(async ({ page }) => {
  await page.goto('/ui-kit.html')
  await expect(page.getByRole('heading', { name: 'UI kit' })).toBeVisible()
})

test.describe('Menu', () => {
  test('opens from the keyboard, navigates with arrows, selects with Enter and restores focus', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'File' })
    await trigger.focus()
    await page.keyboard.press('ArrowDown')

    const menu = page.getByRole('menu', { name: 'File' })
    await expect(menu).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('menuitem', { name: /Open trip/ })).toBeFocused()

    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: 'Save to file' })).toBeFocused()
    // The disabled item is skipped.
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitemradio', { name: 'Drive' })).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.getByRole('menuitem', { name: 'New trip' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: /Open trip/ })).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    await expect(page.getByTestId('menu-last')).toHaveText('open')
    await expect(trigger).toBeFocused()
  })

  test('type-ahead jumps to a matching item', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click()
    await page.keyboard.press('f')
    await expect(page.getByRole('menuitemradio', { name: 'Ferry' })).toBeFocused()
  })

  test('radio items report their state and update on select', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click()
    await expect(page.getByRole('menuitemradio', { name: 'Drive' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('menuitemradio', { name: 'Train' })).toHaveAttribute('aria-checked', 'false')
    await page.getByRole('menuitemradio', { name: 'Train' }).click()
    await expect(page.getByTestId('menu-mode')).toHaveText('train')
  })

  test('closes on Escape (focus returns to the trigger) and on outside click', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'File' })
    const menu = page.getByRole('menu', { name: 'File' })

    await trigger.click()
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()

    await trigger.click()
    await expect(menu).toBeVisible()
    await page.getByRole('heading', { name: 'UI kit' }).click()
    await expect(menu).toBeHidden()

    // Clicking the trigger again toggles it.
    await trigger.click()
    await trigger.click()
    await expect(menu).toBeHidden()
  })

  test('a disabled item does not fire', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click()
    await page.getByRole('menuitem', { name: 'Copy share link' }).click({ force: true })
    await expect(page.getByTestId('menu-last')).toHaveText('')
  })

  test('an end-aligned menu stays inside the viewport', async ({ page }) => {
    await page.getByRole('button', { name: 'More actions' }).click()
    const box = await page.getByRole('menu', { name: 'More' }).boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(1440)
  })
})

test.describe('Dialog', () => {
  test('opens modally and closes with Escape', async ({ page }) => {
    await page.getByRole('button', { name: 'Open dialog' }).click()
    const dialog = page.getByRole('dialog', { name: 'Start a new trip?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Your current trip stays available through undo.')
    expect(await page.evaluate(() => document.querySelector('dialog')?.matches(':modal'))).toBe(true)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    // It can be opened again afterwards (state stayed in sync with the native element).
    await page.getByRole('button', { name: 'Open dialog' }).click()
    await expect(dialog).toBeVisible()
  })

  test('closes from its buttons and from a backdrop click', async ({ page }) => {
    const open = page.getByRole('button', { name: 'Open dialog' })
    const dialog = page.getByRole('dialog')

    await open.click()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()

    await open.click()
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()

    await open.click()
    await page.mouse.click(10, 10)
    await expect(dialog).toBeHidden()
  })

  test('a click inside the dialog does not close it', async ({ page }) => {
    await page.getByRole('button', { name: 'Open dialog' }).click()
    await page.getByText('Places, legs and the title will be cleared.').click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('a drag that starts inside and is released over the backdrop does not close it', async ({ page }) => {
    await page.getByRole('button', { name: 'Open dialog' }).click()
    const text = await page.getByText('Places, legs and the title will be cleared.').boundingBox()
    await page.mouse.move(text!.x + 10, text!.y + text!.height / 2)
    await page.mouse.down()
    await page.mouse.move(10, 10, { steps: 5 })
    await page.mouse.up()
    await expect(page.getByRole('dialog')).toBeVisible()

    // A press and release on the backdrop still closes it.
    await page.mouse.click(10, 10)
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('a toast raised while the dialog is open appears inside it and can be used', async ({ page }) => {
    await page.getByRole('button', { name: 'Open dialog' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Toast from dialog' }).click()

    const toast = dialog.getByTestId('toast')
    await expect(toast).toContainText('Toast from inside the dialog')
    // Not covered by the backdrop: the element on top at its centre belongs to the toast.
    const box = (await toast.boundingBox())!
    const topmost = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="toast"]') !== null,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    )
    expect(topmost).toBe(true)
    await toast.getByRole('button', { name: 'Dismiss' }).click()
    await expect(toast).toBeHidden()
    await expect(dialog).toBeVisible()

    // Closing the dialog hands the region back to the page.
    await dialog.getByRole('button', { name: 'Toast from dialog' }).click()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.locator('body > .toast-host')).toBeVisible()
    await expect(page.getByTestId('toast')).toBeVisible()
  })

  test('a menu inside the dialog opens, is usable, and Escape closes only the menu', async ({ page }) => {
    await page.getByRole('button', { name: 'Open dialog' }).click()
    const dialog = page.getByRole('dialog')
    const options = dialog.getByRole('button', { name: 'Options' })
    await options.click()

    const menu = dialog.getByRole('menu', { name: 'Dialog options' })
    await expect(menu).toBeVisible()
    await expect(page.locator('body > .menu')).toHaveCount(0)
    await expect(menu.getByRole('menuitem').first()).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(options).toBeFocused()

    await options.click()
    await menu.getByRole('menuitem', { name: 'Save to file' }).click()
    await expect(menu).toBeHidden()
    await expect(page.getByTestId('menu-last')).toHaveText('save')
    await expect(dialog).toBeVisible()
  })

  test('tooltips of buttons inside the dialog render inside it', async ({ page }) => {
    await page.getByRole('button', { name: 'Open dialog' }).click()
    await page.getByRole('button', { name: 'Dialog help' }).hover()
    await expect(page.locator('dialog .tooltip')).toHaveText('Dialog help')
    await expect(page.locator('body > .tooltip')).toHaveCount(0)
  })
})

test.describe('Toast', () => {
  test('shows messages with the right roles and can be dismissed', async ({ page }) => {
    await page.getByRole('button', { name: 'Error', exact: true }).click()
    const error = page.getByRole('alert')
    await expect(error).toContainText('Routing failed')

    await page.getByRole('button', { name: 'Success' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Trip saved.' })).toBeVisible()

    await error.getByRole('button', { name: 'Dismiss' }).click()
    await expect(error).toBeHidden()
  })

  test('runs an action and dismisses the toast', async ({ page }) => {
    await page.getByRole('button', { name: 'With action' }).click()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByTestId('toast')).toBeHidden()
    await expect(page.getByTestId('menu-last')).toHaveText('undone')
  })

  test('info toasts disappear on their own', async ({ page }) => {
    await page.getByRole('button', { name: 'Info' }).click()
    await expect(page.getByTestId('toast')).toBeVisible()
    await expect(page.getByTestId('toast')).toBeHidden({ timeout: 8000 })
  })
})

test.describe('IconButton', () => {
  test('has an accessible name and shows a tooltip on hover and on keyboard focus', async ({ page }) => {
    const button = page.getByRole('button', { name: 'Add stop' })
    await button.hover()
    await expect(page.locator('.tooltip')).toHaveText('Add a stop (A)')
    await page.mouse.move(700, 700)
    await expect(page.locator('.tooltip')).toBeHidden()

    await page.getByRole('button', { name: 'Settings' }).focus()
    await page.keyboard.press('Tab')
    await expect(page.locator('.tooltip')).toHaveText('Add a stop (A)')
    await page.keyboard.press('Escape')
    await expect(page.locator('.tooltip')).toBeHidden()
  })
})

test.describe('SegmentedControl', () => {
  test('is a radio group with one tab stop: click, Enter and Space choose, the arrow keys and Home/End only move the focus', async ({ page }) => {
    const group = page.getByRole('radiogroup', { name: 'Travel mode' })
    const radio = (name: string) => group.getByRole('radio', { name })
    const value = page.getByTestId('segment-value')
    await expect(radio('Drive')).toBeChecked()
    await expect(radio('Ferry')).toHaveAttribute('tabindex', '-1')

    await radio('Train').click()
    await expect(value).toHaveText('train')
    await expect(radio('Train')).toBeChecked()

    // Moving the focus chooses nothing, and the tab stop goes with the focus.
    await page.keyboard.press('ArrowRight')
    await expect(radio('Drive')).toBeFocused()
    await expect(radio('Drive')).toHaveAttribute('tabindex', '0')
    await expect(radio('Train')).toHaveAttribute('tabindex', '-1')
    await expect(value).toHaveText('train')
    await page.keyboard.press('ArrowLeft')
    await expect(radio('Train')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(radio('Drive')).toBeFocused()
    await page.keyboard.press('End')
    await expect(radio('Train')).toBeFocused()
    await expect(radio('Train')).toBeChecked()
    await expect(value).toHaveText('train')

    // Enter and Space choose the focused one.
    await page.keyboard.press('ArrowLeft')
    await expect(radio('Ferry')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(value).toHaveText('ferry')
    await expect(radio('Ferry')).toBeChecked()
    await page.keyboard.press('Home')
    await page.keyboard.press('Space')
    await expect(value).toHaveText('drive')
    await expect(radio('Drive')).toBeChecked()
  })
})

test.describe('Switch', () => {
  test('toggles with click, Space and Enter and reports its state', async ({ page }) => {
    const toggle = page.getByRole('switch', { name: 'Follow roads' })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.focus()
    await page.keyboard.press('Space')
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByRole('switch', { name: 'Unavailable' })).toBeDisabled()
  })
})
