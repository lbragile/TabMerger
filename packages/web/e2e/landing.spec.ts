import { test, expect } from '@playwright/test'

test.describe('Landing page', () => {
  test('renders with correct title', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/TabMerger/)
  })

  // The interactive clickable-demo (group switching + live search over mock tabs) was
  // replaced by a static/video walkthrough (components/marketing/DemoSection ->
  // DemoVideo) — there is no "Try it yourself" copy, no group buttons, and no search
  // input on the landing page anymore. The removed tests that exercised that feature
  // (`shows interactive demo section`, `demo group switching works`,
  // `demo search filters tabs`) are deleted rather than retargeted since the feature
  // itself no longer exists.

  test('shows all three browser install links in the hero', async ({ page }) => {
    await page.goto('/')
    // components/marketing/InstallButtons.tsx (the old equal three-button "Add to X"
    // row the previous version of this test targeted) is dead code — never imported by
    // any page. The real install links live inline in Hero.tsx: one primary Chrome CTA
    // plus two secondary Firefox/Edge buttons. Match on href since the visible/aria-label
    // text is asymmetric between the primary and secondary buttons. `.first()` on the
    // Chrome link — FinalCta repeats the same Chrome install link further down the page;
    // Hero's is the first one in DOM order.
    await expect(page.locator('a[href="https://chrome.google.com/webstore"]').first()).toBeVisible()
    await expect(
      page.locator('a[href="https://addons.mozilla.org/firefox/addon/tabmerger"]')
    ).toBeVisible()
    await expect(
      page.locator('a[href="https://microsoftedge.microsoft.com/addons/detail/tabmerger"]')
    ).toBeVisible()
  })

  test('testimonials carousel is visible', async ({ page }) => {
    await page.goto('/')
    // ReviewsStrip's placeholder attributions were renamed (no more "Rachel D.") — the
    // carousel itself is still present, so retarget to a current attribution rather than
    // dropping the test.
    await expect(page.getByText('ALEX T.').first()).toBeVisible()
  })

  test('renders without horizontal overflow at mobile viewport width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')

    // documentElement.scrollWidth should never exceed the viewport width — any excess
    // means something (fixed-width popup mock, unconditional grid-cols-3, etc.) is
    // forcing horizontal scroll on mobile.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual(375)

    // Hero's two-column grid must collapse to a single column below `md`. Scope to the
    // h1 specifically — FinalCta repeats the same copy in an h2, which previously made
    // this locator resolve to 2 elements (strict mode violation).
    const heading = page.getByRole('heading', { level: 1, name: /Stop drowning in browser tabs/i })
    await expect(heading).toBeVisible()
  })
})
