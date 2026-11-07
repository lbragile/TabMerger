import { test, expect, type Page } from '@playwright/test'

/**
 * /compare: the page loads, the dropdown switches the competitor, the product-name row stays in
 * view while the table box scrolls (desktop), the page never pans sideways, and Hebrew lays it
 * out right to left. Public page, so no sign-in.
 */
test.describe('compare page', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  /** The page's own horizontal overflow, with the body's `overflow-x: clip` safety net turned off. */
  async function pageOverflow(page: Page) {
    return page.evaluate(() => {
      document.body.style.overflowX = 'visible'
      document.documentElement.style.overflowX = 'visible'
      return document.documentElement.scrollWidth - document.documentElement.clientWidth
    })
  }

  /** Opens the dropdown; retries because a click before hydration does nothing. */
  async function openPicker(page: Page) {
    const picker = page.getByRole('combobox', { name: 'Compare TabMerger with' })
    await expect(async () => {
      if ((await picker.getAttribute('aria-expanded')) !== 'true') await picker.click()
      await expect(page.getByRole('listbox')).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 15_000 })
  }

  test('loads with its heading and the table', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/compare')
    await expect(page.getByRole('heading', { level: 1, name: 'How TabMerger compares' })).toBeVisible()
    await expect(page.getByRole('table')).toBeAttached()
    await expect(page.getByRole('combobox', { name: 'Compare TabMerger with' })).toContainText('All tools')
    // TabMerger plus nine competitors, plus the feature column.
    await expect(page.locator('thead th')).toHaveCount(11)
  })

  test('the dropdown leaves TabMerger and the chosen competitor (stacked rows) on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/compare')
    await openPicker(page)
    await expect(page.getByRole('option')).toHaveCount(10)
    await page.getByRole('option', { name: 'Toby' }).click()

    await expect(page.getByRole('columnheader', { name: /^Toby/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /^TabMerger/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /^OneTab/ })).toBeHidden()
    await expect(page.locator('[data-compare-layout="stacked"]')).toHaveCount(1)
    await expect(page.locator('thead th:visible')).toHaveCount(2)
  })

  test('the product-name row stays visible after the table box scrolls (desktop)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/compare')
    const box = page.locator('[role="region"][tabindex="0"]')
    await box.scrollIntoViewIfNeeded()
    await box.evaluate((el) => {
      el.scrollTop = el.scrollHeight / 2
    })
    const header = page.getByRole('columnheader', { name: /^TabMerger/ })
    await expect(header).toBeInViewport()
    const [headBox, regionBox] = await Promise.all([header.boundingBox(), box.boundingBox()])
    expect(Math.abs(headBox!.y - regionBox!.y)).toBeLessThanOrEqual(2)
  })

  for (const width of [1280, 390]) {
    test(`no horizontal page overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/compare')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0)
    })
  }

  test('at 390px it shows OneTab by default, and the dropdown switches it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/compare')
    const picker = page.getByRole('combobox', { name: 'Compare TabMerger with' })
    await expect(picker).toContainText('OneTab')
    await expect(page.getByRole('columnheader', { name: /^OneTab/ })).toBeVisible()
    await openPicker(page)
    await expect(page.getByRole('option')).toHaveCount(9)
    await page.getByRole('option', { name: 'Session Buddy' }).click()
    await expect(page.getByRole('columnheader', { name: /^Session Buddy/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /^OneTab/ })).toBeHidden()
  })

  test('/he renders right to left without sideways overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/he/compare')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'he')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0)
  })
})
