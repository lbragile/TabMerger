/**
 * Locale negotiation for routes outside `app/[locale]/` (i18n/negotiate.ts) and its use in the
 * request config (i18n/request.ts): cookie first, then Accept-Language, then the default; a
 * `[locale]` segment always wins.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  canonicalTag,
  LOCALE_COOKIE_ATTRIBUTES,
  localeCookieString,
  negotiateLocale,
  parseAcceptLanguage,
} from '@/i18n/negotiate'

const LOCALES = ['en', 'de', 'fr', 'ja', 'pt-BR', 'zh-CN'] as const

describe('locale cookie', () => {
  it('lasts one year, site-wide, SameSite Lax', () => {
    expect(LOCALE_COOKIE_ATTRIBUTES).toEqual({ name: 'NEXT_LOCALE', maxAge: 31_536_000, path: '/', sameSite: 'lax' })
  })

  it('is written by the switcher with the same attributes', () => {
    expect(localeCookieString('de')).toBe('NEXT_LOCALE=de; max-age=31536000; path=/; SameSite=lax')
  })

  it('is the cookie next-intl sets, with the same attributes', async () => {
    const { routing } = await import('@/i18n/routing')
    expect(routing.localeCookie).toEqual(LOCALE_COOKIE_ATTRIBUTES)
  })
})

describe('parseAcceptLanguage', () => {
  it('orders ranges by q, then by position, and drops q=0 and junk', () => {
    expect(parseAcceptLanguage('fr;q=0.5, de-DE, en;q=0.8, ja;q=0, <script>, *')).toEqual(['de-DE', 'en', 'fr'])
  })

  it.each([null, undefined, ''])('returns nothing for %j', (header) => {
    expect(parseAcceptLanguage(header)).toEqual([])
  })

  it('reads at most the first 512 characters', () => {
    expect(parseAcceptLanguage(`${'x'.repeat(600)},de`)).toEqual([])
  })
})

describe('negotiateLocale', () => {
  it('prefers a valid NEXT_LOCALE cookie over Accept-Language', () => {
    expect(negotiateLocale('ja', 'de-DE,de;q=0.9', LOCALES, 'en')).toBe('ja')
  })

  it('ignores a cookie that is not a supported locale', () => {
    expect(negotiateLocale('xx', 'fr-FR', LOCALES, 'en')).toBe('fr')
    expect(negotiateLocale('../en', undefined, LOCALES, 'en')).toBe('en')
  })

  it('matches exactly (any case), then by primary language', () => {
    expect(negotiateLocale(undefined, 'PT-br', LOCALES, 'en')).toBe('pt-BR')
    expect(negotiateLocale(undefined, 'pt-PT', LOCALES, 'en')).toBe('pt-BR')
    expect(negotiateLocale(undefined, 'zh-TW,zh;q=0.9', LOCALES, 'en')).toBe('zh-CN')
  })

  it('takes the best range that is supported, else the default', () => {
    expect(negotiateLocale(undefined, 'ko, de;q=0.5', LOCALES, 'en')).toBe('de')
    expect(negotiateLocale(undefined, 'ko, it', LOCALES, 'en')).toBe('en')
    expect(negotiateLocale(undefined, null, LOCALES, 'en')).toBe('en')
  })

  describe('deprecated language tags', () => {
    const WITH_HEBREW = [...LOCALES, 'he', 'id']

    it('reads the old Hebrew tag iw as he, in Accept-Language and in the cookie', () => {
      expect(negotiateLocale(undefined, 'iw-IL,iw;q=0.9,en;q=0.5', WITH_HEBREW, 'en')).toBe('he')
      expect(negotiateLocale(undefined, 'iw', WITH_HEBREW, 'en')).toBe('he')
      expect(negotiateLocale('iw', 'de', WITH_HEBREW, 'en')).toBe('he')
    })

    it('reads in as id (Indonesian) the same way', () => {
      expect(negotiateLocale(undefined, 'in-ID', WITH_HEBREW, 'en')).toBe('id')
      expect(negotiateLocale(undefined, 'in', WITH_HEBREW, 'en')).toBe('id')
      expect(negotiateLocale('in', 'de', WITH_HEBREW, 'en')).toBe('id')
    })

    it('changes nothing while he is not a supported locale', () => {
      expect(negotiateLocale(undefined, 'iw-IL,de;q=0.5', LOCALES, 'en')).toBe('de')
      expect(negotiateLocale('iw', 'fr', LOCALES, 'en')).toBe('fr')
      expect(negotiateLocale(undefined, 'iw', LOCALES, 'en')).toBe('en')
    })

    it('leaves a tag the runtime rejects as it is', () => {
      expect(canonicalTag('iw')).toBe('he')
      expect(canonicalTag('../en')).toBe('../en')
      expect(canonicalTag('pt-br')).toBe('pt-BR')
    })
  })
})

describe('request config', () => {
  const cookieGet = vi.fn()
  const headerGet = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    cookieGet.mockReset()
    headerGet.mockReset()
    vi.doMock('next-intl/server', () => ({ getRequestConfig: (fn: unknown) => fn }))
    vi.doMock('next/headers', () => ({
      cookies: async () => ({ get: cookieGet }),
      headers: async () => ({ get: headerGet }),
    }))
  })

  type Config = (args: { requestLocale: Promise<string | undefined> }) => Promise<{ locale: string }>

  async function resolve(requested: string | undefined) {
    const { default: config } = (await import('@/i18n/request')) as unknown as { default: Config }
    return (await config({ requestLocale: Promise.resolve(requested) })).locale
  }

  it('uses the [locale] segment and never reads cookies or headers when there is one', async () => {
    expect(await resolve('en')).toBe('en')
    expect(cookieGet).not.toHaveBeenCalled()
    expect(headerGet).not.toHaveBeenCalled()
  })

  it('falls back to the default for an unknown segment', async () => {
    expect(await resolve('xx')).toBe('en')
  })

  it('negotiates from the cookie, then Accept-Language, for a route without a segment (/auth/*)', async () => {
    const { routing } = await import('@/i18n/routing')
    const other = routing.locales.find((l) => l !== routing.defaultLocale)!
    cookieGet.mockReturnValue({ value: other })
    expect(await resolve(undefined)).toBe(other)

    cookieGet.mockReturnValue(undefined)
    headerGet.mockReturnValue(`${other};q=0.9`)
    expect(await resolve(undefined)).toBe(other)
    expect(headerGet).toHaveBeenCalledWith('accept-language')

    headerGet.mockReturnValue(null)
    expect(await resolve(undefined)).toBe(routing.defaultLocale)
  })
})
