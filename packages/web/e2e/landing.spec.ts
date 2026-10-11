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

  test.describe('hero feature-tour video', () => {
    const TOUR_SRC = { light: /\/videos\/tabmerger-tour-light\.mp4/, dark: /\/videos\/tabmerger-tour-dark\.mp4/ }

    async function openHero(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
      // Seed the visitor's theme before the first load, as a returning visitor would have it.
      await page.addInitScript((t) => localStorage.setItem('theme', t), theme)
      await page.goto('/')
      const video = page.getByLabel('TabMerger feature tour video')
      await expect(video).toBeVisible()
      return video
    }

    for (const theme of ['light', 'dark'] as const) {
      test(`${theme} visitor: plays the ${theme} tour, autoplaying and muted`, async ({ page }) => {
        const video = await openHero(page, theme)
        await expect(video).toHaveAttribute('src', TOUR_SRC[theme])
        await expect(video).toHaveJSProperty('muted', true)
        await expect(video).toHaveJSProperty('loop', true)
        // Autoplay actually started (not just the attribute): time moves on and it is not paused.
        await expect
          .poll(() => video.evaluate((el: HTMLVideoElement) => !el.paused && el.currentTime > 0.5), { timeout: 15_000 })
          .toBe(true)
        // The poster shown before playback is the visitor's own theme's.
        await expect(video).toHaveAttribute('poster', new RegExp(`tour-poster-${theme}\\.jpg`))
      })
    }

    for (const [from, to] of [
      ['light', 'dark'],
      ['dark', 'light'],
    ] as const) {
      test(`switching ${from} to ${to}: swaps the source and continues from the same position while playing`, async ({
        page,
      }) => {
        const video = await openHero(page, from)
        await expect(video).toHaveAttribute('src', TOUR_SRC[from])
        await expect
          .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime), { timeout: 15_000 })
          .toBeGreaterThan(1)
        const before = await video.evaluate((el: HTMLVideoElement) => el.currentTime)

        await page.getByRole('button', { name: 'Toggle theme' }).click()

        await expect(video).toHaveAttribute('src', TOUR_SRC[to])
        // Back to playing on the new source, from where it was (never restarted at 0).
        await expect
          .poll(() => video.evaluate((el: HTMLVideoElement) => !el.paused && el.readyState >= 3), { timeout: 15_000 })
          .toBe(true)
        const after = await video.evaluate((el: HTMLVideoElement) => el.currentTime)
        expect(after).toBeGreaterThanOrEqual(before - 0.5)
        expect(after).toBeLessThan(before + 8)
        await expect(video).toHaveJSProperty('muted', true)
      })
    }

    test('switching theme while paused keeps it paused at the same position', async ({ page }) => {
      const video = await openHero(page, 'light')
      await expect
        .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime), { timeout: 15_000 })
        .toBeGreaterThan(1)
      const paused = await video.evaluate((el: HTMLVideoElement) => {
        el.pause()
        return el.currentTime
      })

      await page.getByRole('button', { name: 'Toggle theme' }).click()

      await expect(video).toHaveAttribute('src', TOUR_SRC.dark)
      await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState), { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
      await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeCloseTo(paused, 1)
      expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true)
    })
  })

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

  // The reviews section reads three live third-party stores on the server, so nothing here
  // depends on what they answer: the section may be present or absent, and the page must
  // render either way. Store requests are server-side fetches, so Playwright cannot stub them.
  test('renders the rest of the page whether or not the reviews section is there', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    const res = await page.goto('/')
    expect(res?.status()).toBe(200)

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Simple, transparent pricing' })).toBeVisible()
    await expect(page.getByRole('contentinfo')).toBeVisible()

    // Either the section is rendered (heading + labelled carousel) or none of it is.
    const reviewsHeading = page.getByRole('heading', { level: 2, name: 'What people are saying' })
    if ((await reviewsHeading.count()) > 0) {
      await expect(reviewsHeading).toBeVisible()
      // The loading placeholder never stays behind once the page has rendered.
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
    }
    expect(errors).toEqual([])
  })

  test('pricing teaser: the monthly equivalent of the yearly price shows on Yearly only', async ({ page }) => {
    await page.goto('/')
    const teaser = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Simple, transparent pricing' }) })
    const pro = teaser.getByText('$3.58/mo billed yearly · save 10%')
    const proAi = teaser.getByText('$7.17/mo billed yearly · save 10%')

    // Monthly (default): the lines hold their space but are hidden from sight and readers.
    await expect(pro).toBeHidden()
    await expect(proAi).toBeHidden()
    await expect(teaser.getByText('No credit card required')).toBeVisible()

    await teaser.getByRole('button', { name: /Yearly/ }).click()
    await expect(pro).toBeVisible()
    await expect(proAi).toBeVisible()
    await expect(pro).not.toHaveAttribute('aria-hidden', 'true')

    await teaser.getByRole('button', { name: 'Monthly' }).click()
    await expect(pro).toBeHidden()
    await expect(proAi).toBeHidden()
  })

  test('the full pricing page keeps its own yearly wording', async ({ page }) => {
    await page.goto('/pricing')
    await page.getByRole('button', { name: /Yearly/ }).click()
    await expect(page.getByText('$3.58/mo billed yearly · save 10%')).toBeVisible()
    await expect(page.getByText('$7.17/mo billed yearly · save 10%')).toBeVisible()
  })
})
