import { test, expect, type Page } from '@playwright/test'

/**
 * The header highlights the page you are on: the matching link carries aria-current="page" (and
 * the active background), in the desktop bar and in the phone menu panel. Public pages, so no
 * sign-in. The signed-in Dashboard/Account rows are covered by the NavLink unit tests.
 *
 * There are no /compare/<slug> subpages in the app (app/[locale]/(marketing)/compare has only
 * page.tsx), so the subpath case is left to the unit tests.
 */
test.describe('active nav link', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  const bar = (page: Page) => page.locator('header nav').first()
  /** The hrefs of the bar's links that are marked current. */
  const currentHrefs = (page: Page) =>
    bar(page).locator('a').evaluateAll((as) => as.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('href')))

  for (const path of ['/pricing', '/features', '/faq']) {
    test(`1280: on ${path} only that header link is current`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto(path)
      await expect(bar(page).locator(`a[href="${path}"]`)).toHaveAttribute('aria-current', 'page')
      expect(await currentHrefs(page)).toEqual([path])
    })
  }

  test('on /es/pricing the Pricing link (by href) is current', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/es/pricing')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(bar(page).locator('a[href="/es/pricing"]')).toHaveAttribute('aria-current', 'page')
    expect(await currentHrefs(page)).toEqual(['/es/pricing'])
  })

  test('on the home page no header link is current', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await expect(bar(page).locator('a')).toHaveCount(5)
    expect(await currentHrefs(page)).toEqual([])
  })

  test('clicking Features from /pricing moves the highlight (client-side navigation)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/pricing')
    const features = bar(page).locator('a[href="/features"]')
    const pricing = bar(page).locator('a[href="/pricing"]')
    await expect(pricing).toHaveAttribute('aria-current', 'page')
    await features.click()
    await expect(page).toHaveURL(/\/features$/)
    await expect(features).toHaveAttribute('aria-current', 'page')
    await expect(pricing).not.toHaveAttribute('aria-current', 'page')
  })

  test('390: the open menu panel marks the current page row', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/pricing')
    const panel = page.locator('#mobile-nav-panel')
    // A click before hydration does nothing, so retry until the panel is there.
    await expect(async () => {
      if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Open menu' }).click()
      await expect(panel).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 15_000 })
    await expect(panel.locator('a[href="/pricing"]')).toHaveAttribute('aria-current', 'page')
    await expect(panel.locator('a[aria-current="page"]')).toHaveCount(1)
  })

  test('1100: highlighting does not shift the link positions', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 })
    const xs = async (path: string) => {
      await page.goto(path)
      await expect(bar(page).locator(`a[href="${path}"]`)).toHaveAttribute('aria-current', 'page')
      return bar(page).locator('a:visible').evaluateAll((as) => as.map((a) => a.getBoundingClientRect().x))
    }
    const onPricing = await xs('/pricing')
    const onFeatures = await xs('/features')
    // Between lg and xl the bar holds four links (Changelog waits for xl).
    expect(onPricing).toHaveLength(4)
    expect(onFeatures).toHaveLength(4)
    onPricing.forEach((x, i) => expect(Math.abs(x - onFeatures[i])).toBeLessThanOrEqual(1))
  })
})
