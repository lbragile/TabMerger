import { test, expect, type Page } from '@playwright/test'

const POST = '/blog/save-all-open-tabs'

/** Console errors and uncaught page errors, collected for the whole test. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

test.describe('Blog', () => {
  test('the index lists the post with no console errors', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/blog')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator(`a[href="${POST}"]`).first()).toBeVisible()
    expect(errors.filter((e) => !/favicon|Failed to load resource/i.test(e))).toEqual([])
  })

  test('the index: descriptive H1, topic chips, featured guide and the list', async ({ page }) => {
    await page.goto('/blog')
    await expect(page.getByRole('heading', { level: 1, name: 'Tab management guides' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Topics' }).getByRole('link', { name: 'All posts' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText('Latest guide')).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'More guides' })).toBeVisible()
    await expect(page).toHaveTitle(/^Tab management guides for Chrome, Edge, Firefox \| TabMerger$/)
  })

  test('/blog/page/1 redirects to /blog, and a page past the end is a 404', async ({ page }) => {
    await page.goto('/blog/page/1')
    await expect(page).toHaveURL(/\/blog$/)
    const res = await page.goto('/blog/page/999')
    expect(res?.status()).toBe(404)
  })

  test('page 2 with a small dev page size (BLOG_DEV_PLACEHOLDERS_PER_PAGE=2)', async ({ page }) => {
    test.skip(!process.env.BLOG_DEV_PLACEHOLDERS_PER_PAGE, 'needs the dev server started with BLOG_DEV_PLACEHOLDERS_PER_PAGE=2')
    await page.goto('/blog/page/2')
    const pager = page.getByRole('navigation', { name: 'Blog pages' })
    await expect(pager.getByRole('link', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')
    await expect(pager.getByRole('link', { name: 'Newer' })).toHaveAttribute('href', '/blog')
    await expect(page.getByText('Latest guide')).toHaveCount(0)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/blog\/page\/2$/)
  })

  test('the post loads with no console errors', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto(POST)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(errors.filter((e) => !/favicon|Failed to load resource/i.test(e))).toEqual([])
  })

  test('the sticky "On this page" and the right rail stay visible while scrolling at 1440', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(POST)
    const toc = page.getByRole('navigation', { name: 'On this page' })
    const rail = page.locator('div.xl\\:sticky')
    await expect(toc).toBeInViewport()
    await expect(rail).toBeInViewport()
    for (const y of [800, 2400, 4800]) {
      await page.evaluate((top) => window.scrollTo(0, top), y)
      await expect(toc).toBeInViewport()
      await expect(rail).toBeInViewport()
    }
  })

  test('the lightbox opens from a figure, updates the hash, and Escape or Back closes it', async ({ page }) => {
    await page.goto(POST)
    const figure = page.getByRole('button', { name: /^Enlarge:/ }).first()
    await figure.scrollIntoViewIfNeeded()
    await figure.click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/#figure-\d+$/)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page).not.toHaveURL(/#figure-/)

    await figure.click()
    await expect(dialog).toBeVisible()
    await page.goBack()
    await expect(dialog).toHaveCount(0)
  })

  test('a #figure-1 link opens the lightbox on load', async ({ page }) => {
    await page.goto(`${POST}#figure-1`)
    await expect(page.locator('dialog[open]')).toBeVisible()
  })

  test('the carousel arrows are centred on the image and the dots sit under it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(POST)
    const carousel = page.locator('section[aria-roledescription]').first()
    await carousel.scrollIntoViewIfNeeded()
    const image = carousel.locator('[data-index="0"] img').first()
    await expect(image).toBeVisible()
    const next = carousel.getByRole('button', { name: /^Next slide/ })
    const [img, arrow] = await Promise.all([image.boundingBox(), next.boundingBox()])
    expect(Math.abs(arrow!.y + arrow!.height / 2 - (img!.y + img!.height / 2))).toBeLessThanOrEqual(2)
    const dots = await carousel.locator('[data-carousel-dots]').boundingBox()
    expect(dots!.y).toBeGreaterThanOrEqual(img!.y + img!.height - 1)
    await next.click()
    await expect(carousel.getByText(/^Slide 2 of/)).toBeAttached()
  })

  test('the share menu opens, and LinkedIn copies the post text and shows the notice', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(POST)
    await page.getByRole('button', { name: 'Share', exact: true }).click()
    await expect(page.getByRole('list', { name: 'Share this article' })).toBeVisible()
    // The composer opens in a new tab: don't navigate to LinkedIn from a test.
    await page.context().route(/linkedin\.com/, (route) => route.abort())
    await page.getByRole('link', { name: 'Share on LinkedIn' }).click()
    await expect(page.getByRole('status')).toHaveText(/Post text copied: paste it into LinkedIn/)
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain(`/blog/save-all-open-tabs`)
  })

  test('the Hebrew post has no horizontal overflow at 390', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto(`/he${POST}`)
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('/download', () => {
  const UAS = {
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0',
    firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:159.0) Gecko/20100101 Firefox/159.0',
    chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  }
  // Production store links aren't used locally: assert the browser-specific target pattern.
  const TARGET = {
    edge: /microsoftedge\.microsoft\.com|\/beta|edge/i,
    firefox: /addons\.mozilla\.org|\/beta|firefox/i,
    chrome: /chromewebstore\.google\.com|chrome\.google\.com|\/beta|chrome/i,
  }

  for (const browser of ['edge', 'firefox', 'chrome'] as const) {
    test(`${browser} is sent to its own install target`, async ({ playwright, baseURL }) => {
      const api = await playwright.request.newContext({ baseURL: baseURL!, userAgent: UAS[browser] })
      const res = await api.get('/download', { maxRedirects: 0 })
      expect(res.status()).toBe(302)
      expect(res.headers()['location']).toMatch(TARGET[browser])
      expect(res.headers()['x-robots-tag']).toBe('noindex')
      await api.dispose()
    })
  }

  test('an iPhone is sent to the homepage install section', async ({ playwright, baseURL }) => {
    const api = await playwright.request.newContext({ baseURL: baseURL!, userAgent: UAS.iphone })
    const res = await api.get('/download', { maxRedirects: 0 })
    expect(res.status()).toBe(302)
    expect(new URL(res.headers()['location']).pathname + new URL(res.headers()['location']).hash).toBe('/#install')
    await api.dispose()
  })

  test('/#install scrolls to the install section', async ({ page }) => {
    await page.goto('/#install')
    await expect(page.locator('#install')).toBeInViewport()
  })
})
