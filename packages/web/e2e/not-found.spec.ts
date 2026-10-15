import { test, expect } from '@playwright/test'

test.describe('404 page', () => {
  // Public page: the same answer signed in or out, so the authenticated project doesn't need it.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('an unknown URL answers 404 with the custom page', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist-e2e')
    expect(response?.status()).toBe(404)

    await expect(page).toHaveTitle(/Page not found/)
    await expect(page.getByRole('heading', { level: 1, name: 'This tab wandered off' })).toBeVisible()
    await expect(page.getByText('Error 404 · Page not found')).toBeVisible()
    // Next adds noindex to every 404 itself; the page sets none of its own, so there is exactly one.
    const robots = page.locator('meta[name="robots"]')
    await expect(robots).toHaveCount(1)
    await expect(robots).toHaveAttribute('content', /noindex/)

    const helpful = page.getByRole('navigation', { name: 'Helpful links' })
    await expect(helpful.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing')

    await page.getByRole('link', { name: 'Back to home' }).click()
    await expect(page).toHaveURL('/')
  })

  test('a nested unknown URL also answers 404', async ({ page }) => {
    const response = await page.goto('/features/does-not-exist')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1, name: 'This tab wandered off' })).toBeVisible()
  })

  test('fits a phone screen without horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await page.goto('/this-page-does-not-exist-e2e')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
