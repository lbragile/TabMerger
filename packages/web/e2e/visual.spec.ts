import { test, expect, type Page } from '@playwright/test'

/**
 * Visual regression tests — Playwright's built-in `toHaveScreenshot()`.
 * Baselines live in `visual.spec.ts-snapshots/` next to this file.
 *
 * Run: `pnpm --filter web test:visual`
 * Update baselines after an intentional visual change:
 *   `pnpm --filter web test:visual -- --update-snapshots`
 *
 * Kept out of the default `test:e2e` run — pixel diffs are sensitive to
 * font/OS rendering and are slower, so they get their own script.
 */

// theme-provider.tsx reads localStorage('theme') synchronously in a head
// script (see app/layout.tsx) before React hydrates, so seeding it via
// addInitScript (registered before the first goto) avoids a flash of the
// wrong theme in the screenshot.
async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme)
}

// A playing <video autoPlay loop muted> is never pixel-stable — pause it and
// seek to a fixed frame before any screenshot involving it.
async function pauseVideo(page: Page) {
  const video = page.locator('video')
  if (!(await video.count())) return

  // Wait for the frame at currentTime=0 to actually be decoded before
  // screenshotting — seeking before enough data has loaded (readyState < 2)
  // leaves the *previous* played frame on screen, which is why the video is
  // pixel-different (mid-animation text) on every run otherwise.
  await video.evaluate(
    (el: HTMLVideoElement) =>
      new Promise<void>((resolve) => {
        el.pause()
        const onSeeked = () => {
          el.removeEventListener('seeked', onSeeked)
          resolve()
        }
        el.addEventListener('seeked', onSeeked)
        if (el.readyState >= 2) {
          el.currentTime = 0
        } else {
          el.addEventListener(
            'loadeddata',
            () => {
              el.currentTime = 0
            },
            { once: true }
          )
        }
      })
  )
  // The player's buffering spinner (components/marketing/DemoVideo.tsx) hides on the `seeked`
  // event awaited above; assert it is gone so a frame with the spinner never becomes a baseline.
  await expect(page.getByTestId('tour-video-spinner')).toHaveCount(0)
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`Visual @visual — ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await setTheme(page, theme)
    })

    test('landing page hero', async ({ page }) => {
      await page.goto('/')
      // DemoSection renders an autoplaying <video> inside the hero — pause it
      // before any screenshot, a playing video is never pixel-stable.
      await pauseVideo(page)
      await expect(page.getByRole('heading', { level: 1, name: /Stop drowning in browser tabs/i })).toBeVisible()
      await expect(page).toHaveScreenshot(`landing-hero-${theme}.png`, {
        fullPage: false,
        // The demo video gets its own dedicated test below — mask it here so
        // any residual frame-decode timing doesn't flake the hero snapshot.
        mask: [page.locator('[aria-label*="stars"]'), page.locator('video')],
      })
    })

    test('pricing table', async ({ page }) => {
      await page.goto('/pricing')
      await expect(page.getByRole('heading', { name: 'Pro', exact: true })).toBeVisible()
      await expect(page).toHaveScreenshot(`pricing-${theme}.png`)
    })

    test('demo section (video paused)', async ({ page }) => {
      await page.goto('/')
      const video = page.locator('video')
      await expect(video).toBeVisible()
      await pauseVideo(page)
      // Native <video> controls (scrubber thumb, timestamp) are browser-chrome,
      // not app content — their pixel position isn't stable across runs and
      // isn't something a visual regression on our UI should care about.
      await video.evaluate((el: HTMLVideoElement) => (el.controls = false))

      await expect(video).toHaveScreenshot(`demo-section-${theme}.png`)
    })
  })
}

// Signed-in dashboard snapshot — only runs under the `authenticated` Playwright
// project (storageState: e2e/.auth/user.json, minted by auth.setup.ts). Skips
// itself under other projects instead of failing, since `chromium` has no session.
test.describe('Visual @visual — dashboard (authenticated)', () => {
  test.beforeEach(({ }, testInfo) => {
    test.skip(testInfo.project.name !== 'authenticated', 'requires the authenticated project')
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`dashboard — ${theme} theme`, async ({ page }) => {
      await setTheme(page, theme)
      await page.goto('/dashboard')
      await pauseVideo(page)
      await expect(page).not.toHaveURL(/\/(login|auth|sign-in)/)
      await expect(page).toHaveScreenshot(`dashboard-${theme}.png`)
    })
  }
})
