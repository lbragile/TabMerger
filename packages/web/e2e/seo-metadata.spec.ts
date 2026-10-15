import { test, expect, type Page } from '@playwright/test'

/**
 * The rendered <head> of the public pages: each page shares and canonicalises as itself, not as
 * the homepage. URLs are compared by path (and to each other) rather than to a fixed origin,
 * because the origin comes from metadataBase, which depends on the server's environment.
 */
const PAGES = [
  { path: '/', title: 'TabMerger — Organize your tabs. Reclaim your focus.' },
  { path: '/features', title: 'Features | TabMerger' },
  { path: '/pricing', title: 'Pricing | TabMerger' },
  { path: '/faq', title: 'FAQ | TabMerger' },
  { path: '/changelog', title: 'Changelog | TabMerger' },
  { path: '/privacy', title: 'Privacy Policy | TabMerger' },
  { path: '/terms', title: 'Terms of Service | TabMerger' },
  { path: '/contact', title: 'Contact | TabMerger' },
]

const meta = (page: Page, attr: 'name' | 'property', key: string) => page.locator(`meta[${attr}="${key}"]`)

test.describe('SEO metadata', () => {
  // Public pages: the same head signed in or out.
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const { path, title } of PAGES) {
    test(`${path} has its own title, canonical and social cards`, async ({ page, baseURL }) => {
      const response = await page.goto(path)
      expect(response?.status()).toBe(200)

      await expect(page).toHaveTitle(title)
      expect(await page.title()).not.toMatch(/TabMerger.*TabMerger/)

      const canonical = page.locator('link[rel="canonical"]')
      await expect(canonical).toHaveCount(1)
      const canonicalHref = (await canonical.getAttribute('href'))!
      const expectedPath = new URL(path, 'http://x').pathname
      expect(new URL(canonicalHref).pathname).toBe(expectedPath)

      await expect(meta(page, 'property', 'og:url')).toHaveCount(1)
      const ogUrl = (await meta(page, 'property', 'og:url').getAttribute('content'))!
      expect(new URL(ogUrl).href).toBe(new URL(canonicalHref).href)
      await expect(meta(page, 'property', 'og:title')).toHaveAttribute('content', title)
      await expect(meta(page, 'name', 'twitter:title')).toHaveAttribute('content', title)

      const description = await meta(page, 'name', 'description').getAttribute('content')
      expect(description).toBeTruthy()
      await expect(meta(page, 'property', 'og:description')).toHaveAttribute('content', description!)
      await expect(meta(page, 'name', 'twitter:description')).toHaveAttribute('content', description!)

      // The social image survives the page's own openGraph/twitter objects, and is really served.
      for (const image of [meta(page, 'property', 'og:image'), meta(page, 'name', 'twitter:image')]) {
        await expect(image).toHaveCount(1)
        const src = new URL((await image.getAttribute('content'))!)
        const fetched = await page.request.get(new URL(src.pathname + src.search, baseURL).href)
        expect(fetched.status()).toBe(200)
        expect(fetched.headers()['content-type']).toContain('image/png')
      }

      await expect(meta(page, 'name', 'robots')).toHaveCount(0)
    })
  }

  test('the homepage has one JSON-LD script that parses', async ({ page }) => {
    await page.goto('/')
    const scripts = page.locator('script[type="application/ld+json"]')
    await expect(scripts).toHaveCount(1)
    const data = JSON.parse((await scripts.textContent())!)
    const app = data['@graph'].find((node: { '@type': string }) => node['@type'] === 'SoftwareApplication')
    expect(app).toMatchObject({
      applicationCategory: 'BrowserApplication',
      offers: { price: '0', priceCurrency: 'USD' },
    })
  })

  test('the 404 carries exactly one robots noindex', async ({ page }) => {
    const response = await page.goto('/seo-metadata-missing-page')
    expect(response?.status()).toBe(404)
    const robots = page.locator('meta[name="robots"]')
    await expect(robots).toHaveCount(1)
    await expect(robots).toHaveAttribute('content', /noindex/)
  })

  test('auth pages are noindex', async ({ page }) => {
    await page.goto('/auth/sign-in')
    const robots = page.locator('meta[name="robots"]')
    await expect(robots).toHaveCount(1)
    await expect(robots).toHaveAttribute('content', /noindex/)
  })
})
