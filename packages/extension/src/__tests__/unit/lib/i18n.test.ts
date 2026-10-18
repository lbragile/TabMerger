import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activeLocale,
  applyDocumentLocale,
  buildI18nOptions,
  formatAndList,
  formatDate,
  formatDateTime,
  formatList,
  formatNumber,
  formatTimeAgo,
  i18n,
  initI18n,
  lazyMessages,
  resolveLocale,
  t
} from '@/lib/i18n'
import { en } from '@/locales/en'
import { SUPPORTED_LOCALES } from '@tabmerger/shared'

describe('resolveLocale', () => {
  it('falls back to English for no tag or a language without a catalog', () => {
    expect(resolveLocale(undefined)).toBe('en')
    expect(resolveLocale('')).toBe('en')
    expect(resolveLocale('ko')).toBe('en')
    expect(resolveLocale('xx-YY')).toBe('en')
  })

  it('accepts a region or underscore variant of a shipped language', () => {
    expect(resolveLocale('en')).toBe('en')
    expect(resolveLocale('en-GB')).toBe('en')
    expect(resolveLocale('EN_us')).toBe('en')
    expect(resolveLocale('fr-CA')).toBe('fr')
    expect(resolveLocale('de-AT')).toBe('de')
  })

  it('matches a shipped regional tag exactly, then falls back to its language sibling', () => {
    expect(resolveLocale('pt-BR')).toBe('pt-BR')
    expect(resolveLocale('pt_br')).toBe('pt-BR')
    expect(resolveLocale('pt-PT')).toBe('pt-BR')
    expect(resolveLocale('pt')).toBe('pt-BR')
    expect(resolveLocale('zh-CN')).toBe('zh-CN')
    expect(resolveLocale('zh-SG')).toBe('zh-CN')
    expect(resolveLocale('zh')).toBe('zh-CN')
  })

  it('keeps Traditional Chinese readers on English rather than Simplified', () => {
    expect(resolveLocale('zh-TW')).toBe('en')
    expect(resolveLocale('zh-HK')).toBe('en')
    expect(resolveLocale('zh-MO')).toBe('en')
    expect(resolveLocale('zh-Hant-TW')).toBe('en')
  })
})

describe('buildI18nOptions', () => {
  it('bundles every catalog, picks the resolved language and initializes synchronously', () => {
    const options = buildI18nOptions('en-US')
    expect(options.lng).toBe('en')
    expect(options.fallbackLng).toBe('en')
    expect(options.initAsync).toBe(false)
    expect(options.interpolation?.escapeValue).toBe(false)
    expect(Object.keys(options.resources ?? {}).sort()).toEqual([...SUPPORTED_LOCALES].sort())
    expect(options.supportedLngs).toEqual([...SUPPORTED_LOCALES])
  })

  it('adds and selects a pseudo catalog when one is passed', () => {
    const catalog = { ...en, header: { ...en.header, undo: '[Ûñðö]' } }
    const options = buildI18nOptions('en', { lng: 'en-XA', catalog })
    expect(options.lng).toBe('en-XA')
    expect(options.supportedLngs).toEqual([...SUPPORTED_LOCALES, 'en-XA'])
    expect((options.resources?.['en-XA'] as { translation: typeof en }).translation.header.undo).toBe('[Ûñðö]')
  })
})

describe('initI18n / t', () => {
  it('is already initialized by the test setup, and a second call keeps the same instance', () => {
    expect(i18n.isInitialized).toBe(true)
    expect(initI18n()).toBe(i18n)
  })

  it('looks up plain, interpolated and plural messages', () => {
    expect(t('header.undo')).toBe('Undo')
    expect(t('common.freeGroupLimit', { max: 5 })).toBe('Free plan allows up to 5 groups.')
    expect(t('common.tabCount', { count: 1 })).toBe('1 tab')
    expect(t('common.tabCount', { count: 0 })).toBe('0 tabs')
    expect(t('common.tabCount', { count: 3 })).toBe('3 tabs')
  })

  it('picks a context variant', () => {
    expect(t('importExport.toast.imported', { skipped: 0 })).toBe('Groups imported successfully')
    expect(t('importExport.toast.imported', { context: 'skipped', skipped: 2 })).toBe('Groups imported successfully, 2 skipped')
  })
})

describe('locale-aware formatting', () => {
  it('formats in the active locale with the same output as en-US', () => {
    expect(activeLocale()).toBe('en')
    const when = Date.UTC(2026, 9, 17, 14, 5)
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }
    expect(formatDateTime(when, opts)).toBe(new Date(when).toLocaleString('en-US', opts))
    expect(formatDate(when, { timeZone: 'UTC' })).toBe(new Date(when).toLocaleDateString('en-US', { timeZone: 'UTC' }))
    expect(formatNumber(3.99, { style: 'currency', currency: 'USD' })).toBe('$3.99')
  })

  it('joins lists', () => {
    expect(formatList(['a', 'b', 'c'])).toBe('a, b, c')
    expect(formatAndList(['a.com', 'b.com'])).toBe('a.com and b.com')
  })

  it('says how long ago, rounded down unless asked to round', () => {
    const now = 10_000_000_000
    expect(formatTimeAgo(now - 30_000, { now })).toBe('just now')
    expect(formatTimeAgo(now - 5 * 60_000, { now })).toBe('5m ago')
    expect(formatTimeAgo(now - 90 * 60_000, { now })).toBe('1h ago')
    expect(formatTimeAgo(now - 90 * 60_000, { now, round: true })).toBe('2h ago')
    expect(formatTimeAgo(now - 3 * 86_400_000, { now })).toBe('3d ago')
  })
})

describe('lazyMessages', () => {
  it('reads each message when the property is read', () => {
    const table = lazyMessages({ undo: 'header.undo', redo: 'header.redo' })
    expect(table.undo).toBe('Undo')
    expect(Object.values(table)).toEqual(['Undo', 'Redo'])
  })
})

describe('applyDocumentLocale', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sets lang and dir on <html>', () => {
    document.documentElement.removeAttribute('lang')
    document.documentElement.removeAttribute('dir')
    applyDocumentLocale()
    expect(document.documentElement.lang).toBe('en')
    expect(document.documentElement.dir).toBe('ltr')
  })

  it('takes the direction from i18next, so a right-to-left catalog sets rtl', () => {
    vi.spyOn(i18n, 'dir').mockReturnValue('rtl')
    const doc = document.implementation.createHTMLDocument('x')
    applyDocumentLocale(doc)
    expect(doc.documentElement.dir).toBe('rtl')
  })
})
