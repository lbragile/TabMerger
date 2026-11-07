/**
 * "Auto-save open tabs" on the marketing site: the plan lines on `/pricing` (Free keeps the newest
 * few, Pro keeps all) and the card on `/features`, in English and in every locale.
 */
import { render, renderHook, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'
import { AUTO_SAVE_COPY, AUTO_SAVE_FREE_KEEP_COUNT, SUPPORTED_LOCALES } from '@tabmerger/shared'
import { loadMessages } from '@/i18n/messages'
import { useTierFeatures } from '@/components/pricing/tierFeatures'
import FeaturesPage from '@/app/[locale]/(marketing)/features/page'

describe('pricing lines', () => {
  it('lists auto-save on Free (newest few kept) right after the sessions line', () => {
    const { result } = renderHook(() => useTierFeatures())
    const free = result.current('free').map((f) => f.text)
    expect(AUTO_SAVE_COPY.pricingFeatureFree).toBe(`Auto-save open tabs (newest ${AUTO_SAVE_FREE_KEEP_COUNT} kept)`)
    expect(free[free.indexOf('Save up to 3 sessions in this browser') + 1]).toBe(AUTO_SAVE_COPY.pricingFeatureFree)
    expect(free).not.toContain(AUTO_SAVE_COPY.pricingFeaturePro)
  })

  it('lists auto-save on Pro (all kept) right after automatic backups', () => {
    const { result } = renderHook(() => useTierFeatures())
    const pro = result.current('pro')
    const texts = pro.map((f) => f.text)
    expect(texts[texts.indexOf('Automatic encrypted backups') + 1]).toBe('Auto-save open tabs, all kept')
    // An added Pro capability (a +), not an "Everything in Free" line.
    expect(pro.find((f) => f.text === AUTO_SAVE_COPY.pricingFeaturePro)?.inherited).toBe(false)
    expect(texts).not.toContain(AUTO_SAVE_COPY.pricingFeatureFree)
  })

  it('leaves Pro AI to "Everything in Pro" instead of repeating the line', () => {
    const { result } = renderHook(() => useTierFeatures())
    for (const mode of ['managed', 'byok'] as const) {
      expect(result.current('proAi', mode).some((f) => /auto-save/i.test(f.text))).toBe(false)
    }
  })

  it.each(SUPPORTED_LOCALES)('%s: translates both lines and shows the Free keep count', async (locale) => {
    const t = createTranslator({ locale, messages: await loadMessages(locale), namespace: 'pricing.features' })
    const free = t('autoSaveFree', { count: AUTO_SAVE_FREE_KEEP_COUNT })
    const pro = t('autoSavePro')
    const count = new Intl.NumberFormat(locale).format(AUTO_SAVE_FREE_KEEP_COUNT)
    expect(free).toContain(count)
    expect(free).not.toMatch(/[{}]/)
    expect(pro).not.toMatch(/[{}]|autoSave/)
    expect(free).not.toBe(pro)
    if (locale !== 'en') {
      expect(free).not.toBe(AUTO_SAVE_COPY.pricingFeatureFree)
      expect(pro).not.toBe(AUTO_SAVE_COPY.pricingFeaturePro)
    }
  })
})

describe('/features card', () => {
  const proSection = () =>
    screen.getByRole('heading', { name: 'Sync & sessions' }).closest('div')?.parentElement as HTMLElement

  it('sits in the Pro section right after Automatic backups, as row 04', async () => {
    render(await FeaturesPage())
    const titles = within(proSection())
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
    expect(titles).toEqual(['Cloud sync', 'Session save & restore', 'Automatic backups', 'Auto-save open tabs', 'Priority support'])
    const row = within(proSection()).getByRole('heading', { name: 'Auto-save open tabs' }).closest('div.grid') as HTMLElement
    expect(row.textContent).toContain('04')
  })

  it('says what is saved, when, what is skipped, and how Free and Pro differ', async () => {
    render(await FeaturesPage())
    const row = within(proSection()).getByRole('heading', { name: 'Auto-save open tabs' }).closest('div.grid') as HTMLElement
    const text = row.textContent ?? ''
    expect(text).toMatch(/aren't in a group yet/)
    expect(text).toMatch(/every 15 minutes to once a day/)
    expect(text).toMatch(/never closes a tab/)
    expect(text).toMatch(/already saved are skipped/)
    expect(text).toMatch(/private windows are never saved/)
    expect(text).toContain(`the newest ${AUTO_SAVE_FREE_KEEP_COUNT} auto-saves are kept`)
    expect(text).toMatch(/count toward the free plan's limits/)
    expect(text).toMatch(/every auto-save is kept/)
    expect(text).toMatch(/end-to-end encrypted/)
  })

  it.each(SUPPORTED_LOCALES)('%s: has a translated title and fills the keep count', async (locale) => {
    const messages = await loadMessages(locale)
    const t = createTranslator({ locale, messages, namespace: 'featuresPage.pro.autoSave' })
    const description = t('description', { count: AUTO_SAVE_FREE_KEEP_COUNT })
    expect(t('title')).toBeTruthy()
    // A plain `{count}` prints ASCII digits; `{count, number}` (Persian) prints the locale's own.
    const digits = [String(AUTO_SAVE_FREE_KEEP_COUNT), new Intl.NumberFormat(locale).format(AUTO_SAVE_FREE_KEEP_COUNT)]
    expect(digits.some((d) => description.includes(d))).toBe(true)
    expect(description).not.toMatch(/[{}]/)
    expect(description).toContain('Pro')
    if (locale !== 'en') expect(t('title')).not.toBe('Auto-save open tabs')
  })
})
