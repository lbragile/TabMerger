import { test, expect, type Page } from '@playwright/test'

/**
 * The rendered <head> of the public pages: each page shares and canonicalises as itself, not as
 * the homepage. URLs are compared by path (and to each other) rather than to a fixed origin,
 * because the origin comes from metadataBase, which depends on the server's environment.
 */
const PAGES = [
  { path: '/', title: 'Tab manager for Chrome, Edge and Firefox | TabMerger' },
  { path: '/features', title: 'Save and organize browser tabs: all features | TabMerger', crumb: 'Features' },
  { path: '/pricing', title: 'Plans and pricing: Free, Pro and Pro AI | TabMerger', crumb: 'Pricing' },
  { path: '/compare', title: 'TabMerger vs OneTab, Session Buddy, Toby, Workona & more', crumb: 'Compare' },
  { path: '/faq', title: 'FAQ: free plan, sync, privacy and browsers | TabMerger', crumb: 'FAQ' },
  { path: '/changelog', title: 'Changelog: release notes and new features | TabMerger', crumb: 'Changelog' },
  { path: '/privacy', title: 'Privacy Policy | TabMerger', crumb: 'Privacy Policy' },
  { path: '/terms', title: 'Terms of Service | TabMerger', crumb: 'Terms of Service' },
  { path: '/contact', title: 'Contact support: bugs, billing and feedback | TabMerger', crumb: 'Contact' },
]

const meta = (page: Page, attr: 'name' | 'property', key: string) => page.locator(`meta[${attr}="${key}"]`)

type JsonLdNode = Record<string, unknown> & { '@type': string }

/** Every JSON-LD script on the page, parsed (each must be valid JSON). */
async function jsonLd(page: Page): Promise<JsonLdNode[]> {
  const texts = await page.locator('script[type="application/ld+json"]').allTextContents()
  return texts.map((text) => JSON.parse(text) as JsonLdNode)
}

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

  for (const { path, crumb } of PAGES.filter((p) => p.crumb)) {
    test(`${path} has a BreadcrumbList ending at its canonical URL`, async ({ page }) => {
      await page.goto(path)
      const trails = (await jsonLd(page)).filter((node) => node['@type'] === 'BreadcrumbList')
      expect(trails).toHaveLength(1)
      const items = trails[0].itemListElement as { position: number; name: string; item: string }[]
      expect(items.map((i) => [i.position, i.name])).toEqual([
        [1, 'TabMerger'],
        [2, crumb],
      ])
      expect(new URL(items[0].item).pathname).toBe('/')
      const canonical = (await page.locator('link[rel="canonical"]').getAttribute('href'))!
      expect(new URL(items[1].item).href).toBe(new URL(canonical).href)
    })
  }

  test('the homepage has one JSON-LD script that parses', async ({ page }) => {
    await page.goto('/')
    const scripts = page.locator('script[type="application/ld+json"]')
    await expect(scripts).toHaveCount(1)
    const data = JSON.parse((await scripts.textContent())!)
    const app = data['@graph'].find((node: { '@type': string }) => node['@type'] === 'SoftwareApplication')
    expect(app).toMatchObject({ applicationCategory: 'BrowserApplication' })
    // One Offer per plan on sale; the free one first, at no cost.
    expect(app.offers[0]).toMatchObject({ name: 'Free', price: '0', priceCurrency: 'USD' })
    expect(app.screenshot).toMatch(/\/opengraph-image\.png$/)
  })

  test('the pricing page offers the plans at the prices it shows', async ({ page }) => {
    await page.goto('/pricing')
    const apps = (await jsonLd(page)).filter((node) => node['@type'] === 'SoftwareApplication')
    expect(apps).toHaveLength(1)
    const offers = apps[0].offers as { name: string; price: string; priceCurrency: string }[]
    expect(offers[0]).toMatchObject({ name: 'Free', price: '0', priceCurrency: 'USD' })
    // Every paid monthly price in the structured data is on the page, as "$<price>".
    for (const { price } of offers.filter((o) => o.price !== '0')) {
      await expect(page.getByText(`$${price}`, { exact: false }).first()).toBeAttached()
    }
  })

  test('the FAQ page has FAQPage JSON-LD matching its visible questions', async ({ page }) => {
    await page.goto('/faq')
    const faqs = (await jsonLd(page)).filter((node) => node['@type'] === 'FAQPage')
    expect(faqs).toHaveLength(1)
    const mainEntity = faqs[0].mainEntity as { name: string }[]
    expect(mainEntity.length).toBeGreaterThan(0)
    for (const { name } of mainEntity) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
    }
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
