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
    //
    // The links depend on the deployment (lib/storeLinks.ts). This suite runs against a
    // local build or the preview site, never production, so it sees the beta targets:
    // Chrome and Edge both go to the Chrome BETA listing, Firefox to the Firefox step of
    // the beta guide (which then starts the beta file). Written out here on purpose: an
    // end-to-end check of the rendered addresses, independent of the app's constants.
    const hero = page.locator('section').filter({ has: page.getByRole('heading', { level: 1 }) })
    const chromeBeta = hero.locator(
      'a[href="https://chromewebstore.google.com/detail/tabmerger-beta/nboljhidpjakiohfdkdjkcljdehcapcd"]'
    )
    await expect(chromeBeta).toHaveCount(2)
    await expect(chromeBeta.first()).toBeVisible()
    await expect(chromeBeta.last()).toBeVisible()
    const firefox = hero.locator('a[href="/beta?download=firefox#firefox"]')
    await expect(firefox).toBeVisible()
    // The Firefox beta link stays on this site; the store links open a new tab.
    await expect(firefox).not.toHaveAttribute('target', '_blank')
    await expect(chromeBeta.first()).toHaveAttribute('target', '_blank')
    // Never the Chrome Web Store home page.
    await expect(page.locator('a[href="https://chrome.google.com/webstore"]')).toHaveCount(0)
  })

  test('landing page shows no invented testimonials', async ({ page }) => {
    await page.goto('/')
    // ReviewsStrip used to render four fabricated testimonials attributed to
    // named people and to real platforms. They were removed; the section now
    // renders only data sourced from the live Chrome Web Store listing, and
    // renders nothing at all when there is none.
    //
    // This asserts their ABSENCE rather than retargeting to another attribution:
    // the previous version of this test was itself retargeted from "Rachel D."
    // to "ALEX T." when the fake names were rewritten, which quietly kept the
    // fabrications covered by a passing test.
    for (const fake of ['ALEX T.', 'PRIYA S.', 'MARCO L.', 'JORDAN K.']) {
      await expect(page.getByText(fake)).toHaveCount(0)
    }
    await expect(page.getByText(/Loved by thousands/i)).toHaveCount(0)
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
