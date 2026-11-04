import { test, expect, type Page } from '@playwright/test'

/**
 * Regression: phones at >=320px must never pan sideways.
 *
 * `body { overflow-x: clip }` (app/globals.css) is only a safety net and hides overflow from
 * `scrollWidth`. To catch the root causes (CTA buttons that did not wrap, unhyphenated long words,
 * a nowrap test-card <code>, a bare URL), every check first turns the clip off, then measures.
 */

const WIDTH = 320

test.use({ viewport: { width: WIDTH, height: 740 }, isMobile: true, hasTouch: true })

const PAGES = ['/', '/pricing', '/de', '/ru', '/de/changelog', '/ko/beta', '/ja/beta', '/ru/features', '/beta', '/de/beta', '/ru/beta']
// Only routable in dev/test servers (PSEUDO_LOCALE_ENABLED in i18n/locales.ts); a production build 404s it.
const PSEUDO_PAGES = ['/en-XA/pricing']

/** Expand every collapsible so hidden content (the Stripe test-card table) is laid out. */
async function expandAll(page: Page) {
  for (let pass = 0; pass < 4; pass++) {
    const opened = await page.evaluate(() => {
      let n = 0
      document.querySelectorAll<HTMLElement>('main button[aria-expanded="false"]').forEach((b) => {
        b.click()
        n++
      })
      document.querySelectorAll<HTMLDetailsElement>('details:not([open])').forEach((d) => {
        d.open = true
        n++
      })
      return n
    })
    if (opened === 0) break
    await page.waitForTimeout(150)
  }
}

/** Disable the clip, then return the page overflow and the outermost elements poking past the viewport. */
async function measureOverflow(page: Page) {
  await page.addStyleTag({ content: 'html,body{overflow-x:visible!important}' })
  return page.evaluate(() => {
    const root = document.documentElement
    const clientWidth = root.clientWidth
    const offenders: string[] = []
    const poking = (el: Element) => el.getBoundingClientRect().right > clientWidth + 0.5
    const walk = (el: Element) => {
      for (const child of Array.from(el.children)) {
        if (poking(child)) {
          const r = child.getBoundingClientRect()
          const text = (child.textContent ?? '').trim().slice(0, 40)
          offenders.push(`<${child.tagName.toLowerCase()} class="${String(child.getAttribute('class') ?? '').slice(0, 80)}"> right=${Math.round(r.right)} "${text}"`)
        } else {
          walk(child)
        }
      }
    }
    walk(document.body)
    return { scrollWidth: root.scrollWidth, clientWidth, offenders: offenders.slice(0, 10) }
  })
}

async function expectNoOverflow(page: Page) {
  const { scrollWidth, clientWidth, offenders } = await measureOverflow(page)
  expect(
    scrollWidth,
    `page is ${scrollWidth}px wide in a ${clientWidth}px viewport; outermost overflowing elements:\n${offenders.join('\n')}`
  ).toBeLessThanOrEqual(clientWidth)
}

test.describe('mobile horizontal overflow (320px)', () => {
  for (const path of PAGES) {
    test(`${path} does not overflow horizontally`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: 'networkidle' })
      expect(res?.status()).toBe(200)
      if (path.endsWith('/beta')) await expandAll(page)
      await expectNoOverflow(page)
    })
  }

  for (const path of PSEUDO_PAGES) {
    test(`${path} (pseudo-locale) does not overflow horizontally`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: 'networkidle' })
      test.skip(res?.status() === 404, 'pseudo-locale is not routable in production builds')
      await expectNoOverflow(page)
    })
  }

  test('the planted-wide-element detector reports an overflow (guards the helper itself)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      const el = document.createElement('div')
      el.id = 'planted-wide'
      el.style.cssText = 'width:600px;height:4px'
      document.querySelector('main')?.appendChild(el)
    })
    const { scrollWidth, clientWidth, offenders } = await measureOverflow(page)
    expect(scrollWidth).toBeGreaterThan(clientWidth)
    expect(offenders.join('\n')).toContain('right=')
  })
})

test.describe('overflow safety net', () => {
  test('body clips horizontal overflow (html stays visible), scrolling sideways does nothing, navbar stays stuck', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })

    const overflow = await page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).overflowX,
      body: getComputedStyle(document.body).overflowX,
    }))
    // The clip lives on body only. html must stay visible: body's overflow then propagates to the
    // viewport, and a Radix scroll lock (body overflow hidden) can't turn body into a scroll container.
    expect(overflow).toEqual({ html: 'visible', body: 'clip' })

    await page.mouse.move(100, 300)
    await page.mouse.wheel(400, 0)
    await page.waitForTimeout(150)
    expect(await page.evaluate(() => window.scrollX)).toBe(0)

    // `clip` (unlike `hidden`) must not turn the root into a scroll container: sticky still sticks.
    await page.evaluate(() => window.scrollTo(0, 1500))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000)
    const headerTop = await page.evaluate(() => document.querySelector('header')?.getBoundingClientRect().top)
    expect(headerTop).toBe(0)
  })
})

test.describe('sticky header survives Radix scroll lock', () => {
  for (const width of [375, 1280]) {
    test(`${width}px: language menu opened after scrolling keeps header and menu on screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 740 })
      await page.goto('/', { waitUntil: 'networkidle' })
      await page.evaluate(() => window.scrollTo(0, 1500))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000)

      await page.locator('header button[aria-label^="Language"]').first().click()
      const menu = page.locator('[role="menu"]').first()
      await expect(menu).toBeVisible()

      const headerTop = await page.evaluate(() => document.querySelector('header')!.getBoundingClientRect().top)
      expect(Math.abs(headerTop), `header top was ${headerTop}`).toBeLessThanOrEqual(1)
      const menuTop = await menu.evaluate((el) => el.getBoundingClientRect().top)
      expect(menuTop, `menu top was ${menuTop}`).toBeGreaterThanOrEqual(0)
    })
  }

  test('375px: mobile nav opened after scrolling keeps header and panel on screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 })
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.evaluate(() => window.scrollTo(0, 1500))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000)

    await page.locator('header button[aria-controls="mobile-nav-panel"]').click()
    const panel = page.locator('#mobile-nav-panel')
    await expect(panel).toBeVisible()

    const headerTop = await page.evaluate(() => document.querySelector('header')!.getBoundingClientRect().top)
    expect(Math.abs(headerTop), `header top was ${headerTop}`).toBeLessThanOrEqual(1)
    const panelTop = await panel.evaluate((el) => el.getBoundingClientRect().top)
    expect(panelTop, `panel top was ${panelTop}`).toBeGreaterThanOrEqual(0)
  })
})
