import { test, expect, type APIRequestContext } from '@playwright/test'

async function probeAiEnabled(request: APIRequestContext): Promise<boolean> {
  const res = await request.post('/api/ai/organize', { data: {} })
  if (res.status() !== 503) return true
  const body = await res.json().catch(() => ({}))
  return body?.error !== 'ai_disabled'
}

test.describe('Pricing page', () => {
  test('renders all three tiers', async ({ page }) => {
    await page.goto('/pricing')
    // Use heading role to avoid strict-mode collisions with other "Free"/"Pro" text on the page
    await expect(page.getByRole('heading', { name: 'Free', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pro', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pro AI', exact: true })).toBeVisible()
  })

  test('shows correct free tier price', async ({ page }) => {
    await page.goto('/pricing')
    // Free tier shows "Free" as the price — scope to the Free tier card to avoid collisions
    const freeTierCard = page.getByRole('heading', { name: 'Free', exact: true }).locator('../..')
    await expect(freeTierCard.getByText('Free').first()).toBeVisible()
  })
})

test.describe('Pro AI card — "coming soon" kill switch', () => {
  test('shows the real Pro AI price with a disabled "Coming soon" CTA when the flag is off, or a normal upgrade CTA when it is on', async ({
    page,
    request,
  }) => {
    const aiEnabled = await probeAiEnabled(request)
    await page.goto('/pricing')

    const proAiCard = page.getByRole('heading', { name: 'Pro AI', exact: true }).locator('../..')
    // Price always renders regardless of flag state — never replaced by placeholder text.
    await expect(proAiCard.getByText(/^\$\d/).first()).toBeVisible()

    if (aiEnabled) {
      await expect(proAiCard.getByRole('button', { name: /Upgrade to Pro AI/i })).toBeEnabled()
      await expect(proAiCard.getByText('Coming soon')).toHaveCount(0)
    } else {
      const cta = proAiCard.getByRole('button', { name: 'Coming soon' })
      await expect(cta).toBeVisible()
      await expect(cta).toBeDisabled()
      await expect(cta).toHaveAttribute('aria-disabled', 'true')
      await expect(proAiCard.getByText('Coming soon').first()).toBeVisible()
    }
  })
})

test.describe('Auth redirect', () => {
  // Force a signed-out context even when this spec runs under the `authenticated`
  // Playwright project (storageState: e2e/.auth/user.json) — this test exists
  // specifically to assert unauthenticated redirect behavior, which a real
  // session would otherwise short-circuit.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('redirects /dashboard to sign-in when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/sign-in/)
  })
})
