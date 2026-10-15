import { test, expect } from '@playwright/test'
import { UNINSTALL_SURVEY_API_PATH } from '@tabmerger/shared'

/**
 * The page the browser opens after the extension is removed. The API route is
 * intercepted, so no email is ever sent from this spec.
 */
test.describe('Uninstall survey page', () => {
  // Public page: it must work signed out, whichever project runs this spec.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('sends the answer with the parsed version, browser and channel, then confirms', async ({ page }) => {
    let posted: Record<string, unknown> | null = null
    await page.route(`**${UNINSTALL_SURVEY_API_PATH}`, async (route) => {
      posted = route.request().postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })

    await page.goto('/uninstalled?v=3.1.2&b=chrome&c=stable')
    await expect(page.getByRole('heading', { level: 1, name: 'TabMerger was removed' })).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    await expect(page.getByRole('link', { name: 'Add TabMerger to Chrome' })).toBeVisible()

    await page.getByRole('button', { name: 'Send answer' }).click()
    await expect(page.getByText('Tick a reason or write a few words before sending.')).toBeVisible()
    expect(posted).toBeNull()

    await page.getByRole('checkbox', { name: 'It slowed my browser down' }).check()
    await page.getByLabel(/anything else you want to tell us/i).fill('It froze on startup.')
    await page.getByRole('button', { name: 'Send answer' }).click()

    // Filtered: Next's route announcer is also a live region on the page.
    const status = page.getByRole('status').filter({ hasText: 'Thanks, this was sent.' })
    await expect(status).toBeVisible()
    await expect(status).toBeFocused()
    expect(posted).toEqual({
      reasons: ['slow'],
      details: 'It froze on startup.',
      email: '',
      version: '3.1.2',
      browser: 'chrome',
      channel: 'stable',
      website: '',
    })
  })

  test('shows a failure with a retry when the send fails', async ({ page }) => {
    await page.route(`**${UNINSTALL_SURVEY_API_PATH}`, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    )
    await page.goto('/uninstalled')
    await page.getByRole('checkbox', { name: 'Something else' }).check()
    await page.getByRole('button', { name: 'Send answer' }).click()
    const alert = page.getByRole('alert').filter({ hasText: 'This was not sent.' })
    await expect(alert).toBeVisible()
    await expect(alert).toBeFocused()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(page.getByText('Thanks, this was sent.')).toHaveCount(0)
  })
})
