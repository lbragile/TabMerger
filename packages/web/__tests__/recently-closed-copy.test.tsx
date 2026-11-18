/**
 * "Recently closed tabs" on the marketing site: the plan lines on `/pricing` (Free and Pro limits
 * from `RECENTLY_CLOSED_LIMITS`), the card on `/features` in every locale, and the privacy page's
 * statement that the list never leaves the device.
 */
import { render, renderHook, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'
import { AUTO_SAVE_COPY, RECENTLY_CLOSED_COPY, RECENTLY_CLOSED_LIMITS, SUPPORTED_LOCALES } from '@tabmerger/shared'
import { loadMessages } from '@/i18n/messages'
import { useTierFeatures } from '@/components/pricing/tierFeatures'
import FeaturesPage from '@/app/[locale]/(marketing)/features/page'
import PrivacyPage from '@/app/[locale]/(marketing)/privacy/page'

const { free, pro } = RECENTLY_CLOSED_LIMITS

/** A number as a locale may print it: ASCII digits or the locale's own (Persian). */
const digitsOf = (locale: string, n: number) => [String(n), new Intl.NumberFormat(locale).format(n)]

/** Whether a message shows the number `n` of days: a dual (Arabic "يومين", Hebrew "יומיים") is a word, not digits. */
const showsDays = (locale: string, text: string, n: number) =>
  new Intl.PluralRules(locale).select(n) === 'two' || digitsOf(locale, n).some((d) => text.includes(d))

describe('pricing lines', () => {
  it('lists the Free limits right after auto-save', () => {
    const { result } = renderHook(() => useTierFeatures())
    const texts = result.current('free').map((f) => f.text)
    expect(texts[texts.indexOf(AUTO_SAVE_COPY.pricingFeatureFree) + 1]).toBe('Recently closed tabs: your last 2 days')
    expect(texts).not.toContain(RECENTLY_CLOSED_COPY.pricingFeaturePro)
  })

  it('lists the Pro limits right after auto-save, as a Pro capability', () => {
    const { result } = renderHook(() => useTierFeatures())
    const lines = result.current('pro')
    const texts = lines.map((f) => f.text)
    expect(texts[texts.indexOf(AUTO_SAVE_COPY.pricingFeaturePro) + 1]).toBe('Recently closed tabs: your last 30 days')
    expect(lines.find((f) => f.text === RECENTLY_CLOSED_COPY.pricingFeaturePro)?.inherited).toBe(false)
    expect(texts).not.toContain(RECENTLY_CLOSED_COPY.pricingFeatureFree)
  })

  it('leaves Pro AI to "Everything in Pro"', () => {
    const { result } = renderHook(() => useTierFeatures())
    for (const mode of ['managed', 'byok'] as const) {
      expect(result.current('proAi', mode).some((f) => /recently closed/i.test(f.text))).toBe(false)
    }
  })

  it.each(SUPPORTED_LOCALES)('%s: translates both lines with their entry and day limits', async (locale) => {
    const t = createTranslator({ locale, messages: await loadMessages(locale), namespace: 'pricing.features' })
    const freeLine = t('recentlyClosedFree', { days: free.recentDays })
    const proLine = t('recentlyClosedPro', { days: pro.days })
    for (const line of [freeLine, proLine]) {
      expect(line).not.toMatch(/[{}]/)
      // Only the days are advertised: the entry counts are storage caps.
      expect(digitsOf(locale, free.entries).some((d) => line.includes(d))).toBe(false)
    }
    expect(showsDays(locale, freeLine, free.recentDays)).toBe(true)
    expect(showsDays(locale, proLine, pro.days)).toBe(true)
    expect(freeLine).not.toBe(proLine)
    if (locale !== 'en') {
      expect(freeLine).not.toBe(RECENTLY_CLOSED_COPY.pricingFeatureFree)
      expect(proLine).not.toBe(RECENTLY_CLOSED_COPY.pricingFeaturePro)
    }
  })
})

describe('/features card', () => {
  const coreSection = () =>
    screen.getByRole('heading', { name: 'Powerful tab management' }).closest('div')?.parentElement as HTMLElement

  it('sits in the Core section right after Full-text search, as row 03', async () => {
    render(await FeaturesPage())
    const titles = within(coreSection())
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
    expect(titles.slice(0, 3)).toEqual(['Named & color-coded groups', 'Full-text search', 'Recently closed tabs'])
    const row = within(coreSection()).getByRole('heading', { name: 'Recently closed tabs' }).closest('div.grid') as HTMLElement
    expect(row.textContent).toContain('03')
  })

  it('says what it does, both plans\' limits, and that it stays on the device', async () => {
    render(await FeaturesPage())
    const row = within(coreSection()).getByRole('heading', { name: 'Recently closed tabs' }).closest('div.grid') as HTMLElement
    const text = row.textContent ?? ''
    expect(text).toMatch(/grouped by day/)
    expect(text).toMatch(/restore a whole window or save it to a group/)
    expect(text).toMatch(/Ctrl\/Cmd\+K: start your search with closed:/)
    expect(text).toContain(`The free plan keeps your ${free.recentDays} most recent days with closed tabs`)
    expect(text).toContain(`Pro keeps your last ${pro.days} days.`)
    expect(text).not.toContain(pro.entries.toLocaleString('en-US'))
    expect(text).toMatch(/never synced, uploaded or exported, private windows are never recorded/)
    expect(text).toMatch(/Settings → Data/)
  })

  it.each(SUPPORTED_LOCALES)("%s: has a translated title and fills both plans' day counts", async (locale) => {
    const t = createTranslator({ locale, messages: await loadMessages(locale), namespace: 'featuresPage.core.recentlyClosed' })
    const description = t('description', { freeDays: free.recentDays, proDays: pro.days })
    expect(description).not.toMatch(/[{}]/)
    expect(showsDays(locale, description, free.recentDays)).toBe(true)
    expect(showsDays(locale, description, pro.days)).toBe(true)
    expect(digitsOf(locale, pro.entries).some((d) => description.includes(d))).toBe(false)
    // The search keyword is literal in every language.
    expect(description).toContain('closed:')
    expect(description).toContain('Pro')
    if (locale !== 'en') expect(t('title')).not.toBe('Recently closed tabs')
  })
})

describe('privacy page', () => {
  it('says the closed-tabs list stays on the device, skips private windows and can be turned off', () => {
    render(<PrivacyPage />)
    const row = document.getElementById('recently-closed') as HTMLElement
    expect(row.closest('section')?.id).toBe('how-stored')
    const text = row.textContent ?? ''
    expect(text).toContain(`for your ${free.recentDays} most recent days with closed tabs on Free and your last ${pro.days} days on Pro and Pro AI`)
    expect(text).toMatch(/in IndexedDB on that device only/)
    expect(text).toMatch(/never synced, uploaded to our servers or included in exports/)
    expect(text).toMatch(/private windows are never recorded/)
    expect(text).toMatch(/turn it off and clear it in the extension's Settings → Data/)
  })
})
