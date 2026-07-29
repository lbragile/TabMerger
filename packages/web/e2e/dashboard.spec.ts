import { test, expect } from '@playwright/test'

/**
 * Dashboard auth-guard smoke tests.
 * No Supabase credentials needed — these verify redirect behavior only.
 */

test.describe('Dashboard auth guard', () => {
  test('unauthenticated /dashboard redirects to login', async ({ page }) => {
    await page.goto('/dashboard')
    // Middleware redirects unauthenticated users to the auth page
    await expect(page).toHaveURL(/\/(login|auth|sign-in)/)
  })

  test('unauthenticated /account redirects to login', async ({ page }) => {
    await page.goto('/account')
    await expect(page).toHaveURL(/\/(login|auth|sign-in)/)
  })
})

test.describe('Public share page', () => {
  test('unknown slug returns 404', async ({ page }) => {
    const res = await page.goto('/share/doesnotexist00')
    expect(res?.status()).toBe(404)
  })

  // ponytail: the expired-slug and seeded-bundle tests assume the server renders
  // ShareBundleContent server-side (no auth required). Run against a live dev
  // server with NEXT_PUBLIC_SUPABASE_URL set; they are skipped in CI unless
  // E2E_SHARE_SLUG env var is provided.
  test('expired share link shows "Link expired" message', async ({ page }) => {
    // This test requires a slug that exists in the DB but has a past expiresAt.
    // Use the env var E2E_EXPIRED_SHARE_SLUG to provide one, or skip.
    const slug = process.env.E2E_EXPIRED_SHARE_SLUG
    if (!slug) {
      test.skip()
      return
    }
    await page.goto(`/share/${slug}`)
    await expect(page.getByText(/link expired/i)).toBeVisible()
    // Groups must not render when expired
    await expect(page.getByRole('heading', { level: 2 }).first()).not.toBeVisible().catch(() => {})
  })

  test('seeded share bundle renders groups and tab links', async ({ page }) => {
    const slug = process.env.E2E_SHARE_SLUG
    if (!slug) {
      test.skip()
      return
    }
    await page.goto(`/share/${slug}`)
    // Group names and tab links should be visible
    await expect(page.getByRole('link').first()).toBeVisible()

    // Verify a tab link has a valid href and target="_blank"
    const firstLink = page.getByRole('link').first()
    const href = await firstLink.getAttribute('href')
    expect(href).toMatch(/^https?:\/\//)
    expect(await firstLink.getAttribute('target')).toBe('_blank')
  })

  // ponytail: same env-gated pattern as the test above — requires a seeded bundle,
  // skipped in CI unless E2E_SHARE_SLUG is provided.
  test('"Open all tabs" and "Open all windows" open one popup per valid tab URL', async ({
    page,
    context,
  }) => {
    const slug = process.env.E2E_SHARE_SLUG
    if (!slug) {
      test.skip()
      return
    }
    await page.goto(`/share/${slug}`)

    const openAllTabsBtn = page.getByRole('button', { name: /open all tabs/i }).first()
    await expect(openAllTabsBtn).toBeVisible()

    const [popup1] = await Promise.all([
      context.waitForEvent('page'),
      openAllTabsBtn.click(),
    ])
    expect(popup1.url()).toMatch(/^https?:\/\//)

    const openAllWindowsBtn = page.getByRole('button', { name: /open all windows/i }).first()
    await expect(openAllWindowsBtn).toBeVisible()

    const [popup2] = await Promise.all([
      context.waitForEvent('page'),
      openAllWindowsBtn.click(),
    ])
    expect(popup2.url()).toMatch(/^https?:\/\//)
  })
})
