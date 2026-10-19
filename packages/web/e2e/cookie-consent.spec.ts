import { test, expect, type Page } from '@playwright/test'

/**
 * Cookie consent by region (lib/consentRegions.ts). The proxy hands the region to the browser in
 * the `tm_consent_region` cookie, from Vercel's geo-IP headers. Locally there are none, so the
 * default is opt-in; the opt-out cases send `x-vercel-ip-country` on the site's own requests
 * (never on third-party ones), as Vercel would. On Vercel the platform sets that header itself.
 *
 * Third-party analytics requests are answered locally with an empty response, so the test never
 * sends anything to Google or PostHog, and recorded so "nothing loaded" can be checked when the
 * dev server has the analytics keys configured.
 */

const ANALYTICS = /googletagmanager\.com|google-analytics\.com|posthog\.com/

/** Stubs analytics requests and returns the list they are recorded in. */
async function recordAnalytics(page: Page): Promise<string[]> {
  const seen: string[] = []
  await page.route(ANALYTICS, (route) => {
    seen.push(route.request().url())
    return route.fulfill({ status: 204, body: '' })
  })
  return seen
}

/** Makes the site's own requests look as if they came from `country` (Vercel's geo-IP header). */
async function fromCountry(page: Page, baseURL: string, country: string) {
  const origin = new URL(baseURL).origin
  await page.route(
    (url) => url.origin === origin,
    (route) => route.continue({ headers: { ...route.request().headers(), 'x-vercel-ip-country': country } })
  )
}

const banner = (page: Page) => page.getByRole('region', { name: 'Cookie consent' })

async function regionCookie(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === 'tm_consent_region')?.value
}

test.describe('Cookie consent by region', () => {
  // No session: consent is the same for everyone, and a stored choice would hide the banner.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('opt-in (no geo headers, as on localhost): asks first and loads no analytics before Accept', async ({ page }) => {
    const analytics = await recordAnalytics(page)
    await page.goto('/pricing')
    await expect(banner(page)).toBeVisible()
    await expect(banner(page)).toContainText("They're set only if you accept")
    expect(await regionCookie(page)).toBe('optin')
    await page.waitForLoadState('networkidle')
    expect(analytics).toEqual([])

    await banner(page).getByRole('button', { name: 'Reject' }).click()
    await expect(banner(page)).toBeHidden()
    await page.reload()
    await expect(banner(page)).toBeHidden()
    expect(analytics).toEqual([])
  })

  test('opt-in region by geo header (DE): asks first', async ({ page, baseURL }) => {
    await recordAnalytics(page)
    await fromCountry(page, baseURL!, 'DE')
    await page.goto('/pricing')
    await expect(banner(page)).toBeVisible()
    expect(await regionCookie(page)).toBe('optin')
  })

  test('opt-out region (US): no banner unasked; Cookie settings says analytics are on, and Reject sticks', async ({
    page,
    baseURL,
  }) => {
    await recordAnalytics(page)
    await fromCountry(page, baseURL!, 'US')
    await page.goto('/pricing')
    expect(await regionCookie(page)).toBe('optout')
    await page.waitForLoadState('networkidle')
    await expect(banner(page)).toBeHidden()

    await page.getByRole('contentinfo').getByRole('button', { name: 'Cookie settings' }).click()
    await expect(banner(page)).toBeVisible()
    await expect(banner(page)).toContainText('are on for this site in your region')

    await banner(page).getByRole('button', { name: 'Reject' }).click()
    await expect(banner(page)).toBeHidden()
    expect((await page.context().cookies()).find((c) => c.name === 'tm_consent')?.value).toBe('denied')
  })

  test('Global Privacy Control: no banner and no analytics, even in an opt-out region; Cookie settings explains', async ({
    page,
    baseURL,
  }) => {
    const analytics = await recordAnalytics(page)
    await page.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true }))
    await fromCountry(page, baseURL!, 'US')
    await page.goto('/pricing')
    await page.waitForLoadState('networkidle')
    await expect(banner(page)).toBeHidden()
    expect(analytics).toEqual([])

    await page.getByRole('contentinfo').getByRole('button', { name: 'Cookie settings' }).click()
    await expect(banner(page)).toContainText('Global Privacy Control signal, so analytics')
  })

  test('the region cookie is set on page responses only, never on API routes', async ({ request }) => {
    const page = await request.get('/pricing', { headers: { 'x-vercel-ip-country': 'US' } })
    expect(page.headers()['set-cookie'] ?? '').toMatch(/tm_consent_region=optout/)
    const api = await request.get('/api/track', { headers: { 'x-vercel-ip-country': 'US' } })
    expect(api.headers()['set-cookie'] ?? '').not.toMatch(/tm_consent_region/)
  })
})
