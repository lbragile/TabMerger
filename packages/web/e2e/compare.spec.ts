import { test, expect, type Page } from '@playwright/test'

/**
 * /compare: the page loads, the dropdown switches the competitor, the product-name row stays in
 * view while the table box scrolls (desktop), the page never pans sideways, and Hebrew lays it
 * out right to left. Public page, so no sign-in.
 */
test.describe('compare page', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  /** The page's own horizontal overflow, with the body's `overflow-x: clip` safety net turned off. */
  async function pageOverflow(page: Page) {
    return page.evaluate(() => {
      document.body.style.overflowX = 'visible'
      document.documentElement.style.overflowX = 'visible'
      return document.documentElement.scrollWidth - document.documentElement.clientWidth
    })
  }

  /** Opens the dropdown; retries because a click before hydration does nothing. */
  async function openPicker(page: Page) {
    const picker = page.getByRole('combobox', { name: 'Compare TabMerger with' })
    await expect(async () => {
      if ((await picker.getAttribute('aria-expanded')) !== 'true') await picker.click()
      await expect(page.getByRole('listbox')).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 15_000 })
  }

  test('loads with its heading and the table', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/compare')
    await expect(page.getByRole('heading', { level: 1, name: 'How TabMerger compares' })).toBeVisible()
    await expect(page.getByRole('table')).toBeAttached()
    await expect(page.getByRole('combobox', { name: 'Compare TabMerger with' })).toContainText('All tools')
    // TabMerger plus nine competitors, plus the feature column.
    await expect(page.locator('thead th')).toHaveCount(11)
  })

  test('the dropdown leaves TabMerger and the chosen competitor (stacked rows) on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/compare')
    await openPicker(page)
    await expect(page.getByRole('option')).toHaveCount(10)
    await page.getByRole('option', { name: 'Toby' }).click()

    await expect(page.getByRole('columnheader', { name: /^Toby/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /^TabMerger/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /^OneTab/ })).toBeHidden()
    await expect(page.locator('[data-compare-layout="stacked"]')).toHaveCount(1)
    await expect(page.locator('thead th:visible')).toHaveCount(2)
  })

  test('the product-name row stays visible after the table box scrolls (desktop)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/compare')
    const box = page.locator('[role="region"][tabindex="0"]')
    await box.scrollIntoViewIfNeeded()
    await box.evaluate((el) => {
      el.scrollTop = el.scrollHeight / 2
    })
    const header = page.getByRole('columnheader', { name: /^TabMerger/ })
    await expect(header).toBeInViewport()
    const [headBox, regionBox] = await Promise.all([header.boundingBox(), box.boundingBox()])
    expect(Math.abs(headBox!.y - regionBox!.y)).toBeLessThanOrEqual(2)
  })

  for (const width of [1280, 390]) {
    test(`no horizontal page overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/compare')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0)
    })
  }

  test('at 390px it shows OneTab by default, and the dropdown switches it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/compare')
    const picker = page.getByRole('combobox', { name: 'Compare TabMerger with' })
    await expect(picker).toContainText('OneTab')
    await expect(page.getByRole('columnheader', { name: /^OneTab/ })).toBeVisible()
    await openPicker(page)
    await expect(page.getByRole('option')).toHaveCount(9)
    await page.getByRole('option', { name: 'Session Buddy' }).click()
    await expect(page.getByRole('columnheader', { name: /^Session Buddy/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /^OneTab/ })).toBeHidden()
  })

  test('/he renders right to left without sideways overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/he/compare')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'he')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0)
  })

  const box = (page: Page) => page.locator('[role="region"][tabindex="0"]')
  const toolArrows = (page: Page) => page.getByRole('button', { name: /^(Previous|Next) tool$/ })
  const sectionButtons = (page: Page) => page.getByRole('button', { name: /^(Previous|Next) section/ })

  async function ready(page: Page, width: number, height = 900, path = '/compare') {
    await page.setViewportSize({ width, height })
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // The controls render after hydration; wait for the picker to be interactive.
    await page.waitForLoadState('networkidle').catch(() => {})
  }

  test.describe('section bar', () => {
    test('next lands the section header right under the product row (1280)', async ({ page }) => {
      await ready(page, 1280)
      await box(page).scrollIntoViewIfNeeded()
      const next = page.getByRole('button', { name: /^Next section: / })
      await expect(next).toBeVisible()
      await expect(page.getByRole('button', { name: 'Previous section' })).toBeDisabled()
      await next.click()
      const header = page.locator('tbody th[scope="colgroup"]').nth(1)
      await expect
        .poll(
          async () => {
            const [h, row] = await Promise.all([header.boundingBox(), page.locator('thead th').filter({ hasText: /^TabMerger/ }).boundingBox()])
            return Math.abs(h!.y - (row!.y + row!.height))
          },
          { timeout: 5000 }
        )
        .toBeLessThanOrEqual(3)
      await expect(page.getByRole('button', { name: /^Previous section: / })).toBeEnabled()
    })

    for (const [w, h] of [
      [1280, 900],
      [1366, 768],
    ]) {
      test(`the legend bottom is inside the viewport after scrolling to the table (${w}x${h})`, async ({ page }) => {
        await ready(page, w, h)
        await page.evaluate(() => document.getElementById('compare-table')!.scrollIntoView())
        await page.waitForTimeout(400)
        const legend = await page.getByRole('list', { name: 'Key' }).boundingBox()
        expect(legend!.y + legend!.height).toBeLessThanOrEqual(h)
      })
    }
  })

  test.describe('tool arrows', () => {
    test('1280: both arrows sit outside the box and there are no rails', async ({ page }) => {
      await ready(page, 1280)
      await expect(toolArrows(page)).toHaveCount(2)
      const b = (await box(page).boundingBox())!
      const prev = (await page.getByRole('button', { name: 'Previous tool' }).boundingBox())!
      const next = (await page.getByRole('button', { name: 'Next tool' }).boundingBox())!
      expect(prev.x + prev.width).toBeLessThanOrEqual(b.x + 0.5)
      expect(next.x).toBeGreaterThanOrEqual(b.x + b.width - 0.5)
      // A rail is a bordered opaque strip inside the box; outside arrows are in a plain wrapper.
      for (const name of ['Previous tool', 'Next tool']) {
        const cls = await page.getByRole('button', { name }).locator('xpath=..').getAttribute('class')
        expect(cls).not.toMatch(/border-(e|s)/)
      }
    })

    test('1024: rails render, next moves exactly one column and disables at the far end', async ({ page }) => {
      await ready(page, 1024)
      await expect(toolArrows(page)).toHaveCount(2)
      const b = (await box(page).boundingBox())!
      const rail = (await page.getByRole('button', { name: 'Previous tool' }).locator('xpath=..').boundingBox())!
      const nextSection = (await page.getByRole('button', { name: /^Next section/ }).boundingBox())!
      expect(rail.y).toBeLessThanOrEqual(b.y + 1)
      expect(rail.y + rail.height).toBeLessThanOrEqual(nextSection.y + 2)
      // Nothing scrolled shows between TabMerger's header cell and the start rail.
      const tm = (await page.locator('thead th').filter({ hasText: /^TabMerger/ }).boundingBox())!
      expect(Math.abs(rail.x - (tm.x + tm.width))).toBeLessThanOrEqual(1.5)

      const next = page.getByRole('button', { name: 'Next tool' })
      const prev = page.getByRole('button', { name: 'Previous tool' })
      await expect(prev).toBeDisabled()
      const colX = async (id: string) => (await page.locator(`thead th[data-col="${id}"]`).boundingBox())!.x
      const onetabBefore = await colX('onetab')
      const sessionBefore = await colX('sessionBuddy')
      await next.click()
      // One column: Session Buddy lands at the pinned edge, just after the rail.
      // The pinned edge includes the 2.5rem (40px) start rail.
      await expect.poll(async () => Math.abs((await colX('sessionBuddy')) - (onetabBefore + 40))).toBeLessThanOrEqual(2)
      expect(sessionBefore).toBeGreaterThan(onetabBefore)
      for (let i = 0; i < 12 && (await next.isEnabled()); i++) {
        await next.click()
        await page.waitForTimeout(500)
      }
      await expect(next).toBeDisabled()
      await expect(prev).toBeEnabled()
    })

    test('picking one competitor removes arrows and rails; "All tools" brings them back', async ({ page }) => {
      await ready(page, 1024)
      await expect(toolArrows(page)).toHaveCount(2)
      await openPicker(page)
      await page.getByRole('option', { name: 'Toby' }).click()
      await expect(toolArrows(page)).toHaveCount(0)
      await openPicker(page)
      await page.getByRole('option', { name: 'All tools' }).click()
      await expect(toolArrows(page)).toHaveCount(2)
    })

    test('below 768 there are no tool arrows and no section bar', async ({ page }) => {
      await ready(page, 390, 844)
      await expect(toolArrows(page)).toHaveCount(0)
      await expect(sectionButtons(page)).toHaveCount(0)
    })

    test('without JavaScript there are no arrows and no section bar, and the table is complete', async ({ browser }) => {
      const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } })
      const page = await ctx.newPage()
      await page.goto('/compare')
      await expect(page.getByRole('table')).toBeAttached()
      await expect(page.locator('thead th')).toHaveCount(11)
      await expect(toolArrows(page)).toHaveCount(0)
      await expect(sectionButtons(page)).toHaveCount(0)
      await ctx.close()
    })

    test('he at 1024: rails mirror and next still advances', async ({ page }) => {
      await ready(page, 1024, 900, '/he/compare')
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
      // Hebrew labels.
      const arrows = page.getByRole('button', { name: /^(הכלי הקודם|הכלי הבא)$/ })
      await expect(arrows).toHaveCount(2)
      const b = (await box(page).boundingBox())!
      // The pinned columns are on the right in RTL: the start rail is right of the box centre.
      const startRail = (await arrows.first().locator('xpath=..').boundingBox())!
      expect(startRail.x + startRail.width / 2).toBeGreaterThan(b.x + b.width / 2)
      const colX = async (id: string) => (await page.locator(`thead th[data-col="${id}"]`).boundingBox())!.x
      const onetabBefore = await colX('onetab')
      await page.getByRole('button', { name: 'הכלי הבא' }).click()
      // Next moves toward later columns, which is leftward in RTL: the content slides toward the start (right) edge, one column.
      await expect.poll(async () => (await colX('onetab')) - onetabBefore).toBeGreaterThan(100)
    })
  })

  test.describe('header nav', () => {
    // Below lg the header holds the menu button instead of the link bar, so no translated label
    // can be cut off there, whatever the platform's fonts.
    for (const locale of ['de', 'fr']) {
      test(`${locale} at 768px: the menu button replaces the link bar`, async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 800 })
        await page.goto(`/${locale}/compare`)
        await expect(page.locator('header button[aria-expanded]:not([aria-haspopup])')).toBeVisible()
        await expect(page.locator('header nav').first()).toBeHidden()
      })
    }

    // From lg the bar shows four links (Changelog joins at xl) and must leave real room before the
    // controls: at least 2rem, so fonts that render wider (Linux CI) can't clip the last link.
    for (const locale of ['de', 'fr', 'ru', 'vi', 'pt-BR']) {
      test(`${locale} at 1024px: the bar leaves at least 2rem before the controls and Changelog waits for xl`, async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 800 })
        await page.goto(`/${locale}/compare`)
        const nav = page.locator('header nav').first()
        await expect(nav).toBeVisible()
        await expect(nav.locator('a[href$="/changelog"]')).toBeHidden()
        const slackRem = await page.evaluate(() => {
          const header = document.querySelector('header')!
          const bar = header.querySelector('nav')!
          const rtl = getComputedStyle(header).direction === 'rtl'
          const shown = (el: Element) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0
          const last = [...bar.querySelectorAll('a')].filter(shown).at(-1)!.getBoundingClientRect()
          const navRect = bar.getBoundingClientRect()
          const controls = [...header.querySelectorAll('a, button')]
            .filter((el) => !bar.contains(el) && shown(el))
            .map((el) => el.getBoundingClientRect())
            .filter((r) => (rtl ? r.right <= navRect.left + 1 : r.left >= navRect.right - 1))
          const gap = rtl ? last.left - Math.max(...controls.map((r) => r.right)) : Math.min(...controls.map((r) => r.left)) - last.right
          return gap / parseFloat(getComputedStyle(document.documentElement).fontSize)
        })
        expect(slackRem).toBeGreaterThanOrEqual(2)
        expect(await nav.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
      })
    }

    test('1280: Changelog is in the bar, after Compare', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto('/compare')
      const hrefs = await page.locator('header nav').first().locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
      expect(hrefs).toEqual(['/features', '/pricing', '/compare', '/changelog', '/faq'])
    })

    test('the mobile menu lists Changelog', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/compare')
      await expect(async () => {
        await page.getByRole('button', { name: 'Open menu' }).click()
        await expect(page.getByRole('navigation', { name: 'Menu', exact: true }).getByRole('link', { name: 'Changelog' })).toBeVisible({ timeout: 1000 })
      }).toPass({ timeout: 15_000 })
    })
  })
})
