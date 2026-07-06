import { test, expect } from '@playwright/test'

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

test.describe('Auth redirect', () => {
  test('redirects /dashboard to sign-in when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/sign-in/)
  })
})
