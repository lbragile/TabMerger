import { test, expect } from '@playwright/test'

test.describe('Landing page', () => {
  test('renders with correct title', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/TabMerger/)
  })

  test('shows interactive demo section', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Try it yourself')).toBeVisible()
  })

  test('demo group switching works', async ({ page }) => {
    await page.goto('/')

    // Click Research group
    await page.getByRole('button', { name: /Research/i }).click()
    await expect(page.getByText('MDN — CSS Grid Guide')).toBeVisible()

    // Click Work group (button label includes tab count, e.g. "Work 4")
    await page.getByRole('button', { name: /^Work/i }).click()
    await expect(page.getByText('Linear — Project Board')).toBeVisible()
  })

  test('demo search filters tabs', async ({ page }) => {
    await page.goto('/')

    // Search input is in the popup header
    const searchInput = page.getByPlaceholder('Search tabs...')
    await searchInput.fill('git')

    // Matching tab is fully visible
    await expect(page.getByText('GitHub — Pull Requests')).toBeVisible()

    // Clearing search restores all tabs
    await searchInput.clear()
    await expect(page.getByText('Linear — Project Board')).toBeVisible()
  })

  test('shows all three browser install buttons', async ({ page }) => {
    await page.goto('/')
    // Use getByRole — accessible name includes SVG aria-label + visible text
    await expect(page.getByRole('link', { name: 'Chrome Add to Chrome' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Firefox Add to Firefox' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Edge Add to Edge' })).toBeVisible()
  })

  test('testimonials carousel is visible', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Rachel D.').first()).toBeVisible()
  })
})
