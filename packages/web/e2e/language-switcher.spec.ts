import { test, expect } from '@playwright/test'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@tabmerger/shared'

/**
 * The header language picker: searching it and switching to a right-to-left language. The
 * switch is a full page load under the new prefix (LanguageMenu's `switchLocale`), and the new
 * page is laid out right to left.
 */
test.describe('language switcher', () => {
  // Public pages: the same signed in or out, so the authenticated project doesn't need it.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('finds Hebrew by typing "heb", picks it with Enter, and lands on /he right to left', async ({ page }) => {
    await page.goto('/pricing')
    await page.getByRole('button', { name: 'Language: English (EN)' }).click()

    const search = page.getByRole('searchbox', { name: 'Search languages by name or code' })
    await expect(search).toBeFocused()
    await expect(search).toHaveAttribute('placeholder', 'Search languages (e.g. German, de)')
    await page.keyboard.type('heb')
    await expect(page.getByRole('menuitemradio')).toHaveCount(1)
    await expect(page.getByRole('menuitemradio', { name: 'עברית' })).toBeVisible()

    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/he\/pricing$/)
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'he')
  })

  test('opens on /he with Hebrew, the checked language near the end of the list, in view', async ({ page }) => {
    await page.goto('/he/pricing')
    await page.getByRole('button', { name: 'שפה: עברית (HE)' }).click()
    await expect(page.getByRole('searchbox')).toBeFocused()
    const hebrew = page.getByRole('menuitemradio', { name: /^עברית/ })
    await expect(hebrew).toHaveAttribute('aria-checked', 'true')
    // In view inside the scrolling list, not just in the page (the list clips it otherwise). Not
    // ratio 1: fractional row heights leave it a sub-pixel short of fully visible (0.996).
    await expect(hebrew).toBeInViewport({ ratio: 0.95 })
  })

  test('shows the whole search placeholder in every language on a 320px phone', async ({ page }) => {
    // One string per locale serves every width, so the narrowest screen decides. Chrome's
    // input scrollWidth doesn't grow with an overflowing placeholder (it stays equal to
    // clientWidth while the text is clipped), so the text is measured with a hidden span in the
    // input's own font, against the input's inner width less a 1rem slot for the clear button.
    test.slow()
    await page.setViewportSize({ width: 320, height: 700 })
    for (const locale of SUPPORTED_LOCALES) {
      await page.goto(locale === DEFAULT_LOCALE ? '/pricing' : `/${locale}/pricing`)
      await page.locator('header button[aria-haspopup="menu"]').first().click()
      const search = page.getByRole('searchbox')
      await expect(search).toBeFocused()
      await expect(search).toHaveValue('')
      const fit = await search.evaluate(async (el: HTMLInputElement) => {
        await document.fonts.ready
        const style = getComputedStyle(el)
        const probe = document.createElement('span')
        probe.textContent = el.placeholder
        probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.font};letter-spacing:${style.letterSpacing}`
        el.parentElement!.appendChild(probe)
        const used = probe.getBoundingClientRect().width
        probe.remove()
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
        const available = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - rem
        return { used, available, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
      })
      expect(fit.scrollWidth, locale).toBeLessThanOrEqual(fit.clientWidth)
      expect(fit.used, `${locale}: placeholder ${fit.used}px, room ${fit.available}px`).toBeLessThanOrEqual(fit.available)
      await page.keyboard.press('Escape')
    }
  })

  test('says when nothing matches, and the list scrolls within the screen', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 500 })
    await page.goto('/pricing')
    await page.getByRole('button', { name: 'Language: English (EN)' }).click()

    // A short window: the menu stays on screen and its list scrolls.
    const menu = page.getByRole('menu')
    const box = await menu.boundingBox()
    expect(box && box.y + box.height).toBeLessThanOrEqual(500)
    const list = menu.locator('.overflow-y-auto')
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

    await page.keyboard.type('klingon')
    await expect(menu.getByRole('status')).toHaveText('No languages found')
  })

  test('shows the language button on a phone, and the menu stays on screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await page.goto('/pricing')
    const button = page.getByRole('button', { name: 'Language: English (EN)' })
    await expect(button).toBeVisible()
    await button.click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const box = await menu.boundingBox()
    expect(box && box.x).toBeGreaterThanOrEqual(0)
    expect(box && box.x + box.width).toBeLessThanOrEqual(375)
    // The hamburger panel has no language list of its own any more.
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Open menu' }).click()
    await expect(page.getByRole('menuitemradio')).toHaveCount(0)
  })
})
