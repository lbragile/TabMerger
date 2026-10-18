import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  consentCookieString,
  deleteCookies,
  getConsentChoice,
  isCookieSettingsOpen,
  openCookieSettings,
  parseConsent,
  readConsentCookie,
  resetConsentStateForTests,
  setConsentChoice,
  subscribeConsent,
} from '@/lib/consent'

function clearCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
  }
}

afterEach(() => {
  clearCookies()
  resetConsentStateForTests()
})

describe('parseConsent', () => {
  it('accepts exactly the two choices', () => {
    expect(parseConsent('granted')).toBe('granted')
    expect(parseConsent('denied')).toBe('denied')
  })

  it.each([undefined, null, '', 'GRANTED', 'granted ', 'yes', 'true', 1, {}, ['granted']])(
    'treats %j as no choice',
    (value) => {
      expect(parseConsent(value)).toBeNull()
    }
  )
})

describe('readConsentCookie', () => {
  it('finds the choice among other cookies', () => {
    expect(readConsentCookie('NEXT_LOCALE=de; tm_consent=granted; _ga=GA1.1.1')).toBe('granted')
    expect(readConsentCookie('tm_consent=denied')).toBe('denied')
  })

  it('is no choice when the cookie is missing, empty or holds anything else', () => {
    expect(readConsentCookie('')).toBeNull()
    expect(readConsentCookie('NEXT_LOCALE=de')).toBeNull()
    expect(readConsentCookie('tm_consent=')).toBeNull()
    expect(readConsentCookie('tm_consent=maybe')).toBeNull()
    expect(readConsentCookie('tm_consent=granted%00')).toBeNull()
    expect(readConsentCookie('tm_consent=<script>')).toBeNull()
  })

  it('treats malformed percent-encoding as no choice instead of throwing', () => {
    expect(readConsentCookie('tm_consent=%E0%A4%A')).toBeNull()
  })

  it('decodes a percent-encoded valid value', () => {
    expect(readConsentCookie('tm_consent=%67ranted')).toBe('granted')
  })

  it('matches the exact cookie name only', () => {
    expect(readConsentCookie('xtm_consent=granted; tm_consent_old=granted')).toBeNull()
  })

  it('uses the first tm_consent cookie (the most specific path)', () => {
    expect(readConsentCookie('tm_consent=denied; tm_consent=granted')).toBe('denied')
    expect(readConsentCookie('tm_consent=junk; tm_consent=granted')).toBeNull()
  })
})

describe('consentCookieString', () => {
  it('is a year-long, site-wide, SameSite=Lax cookie, Secure on https only', () => {
    expect(consentCookieString('granted', true)).toBe(
      `${CONSENT_COOKIE}=granted; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax; Secure`
    )
    expect(consentCookieString('denied', false)).toBe(
      `${CONSENT_COOKIE}=denied; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`
    )
    expect(CONSENT_MAX_AGE_SECONDS).toBe(31_536_000)
  })
})

describe('consent store', () => {
  it('has no choice until one is made, then reads it from the cookie', () => {
    expect(getConsentChoice()).toBeNull()
    setConsentChoice('granted')
    expect(document.cookie).toContain('tm_consent=granted')
    expect(getConsentChoice()).toBe('granted')
    setConsentChoice('denied')
    expect(document.cookie).toContain('tm_consent=denied')
    expect(getConsentChoice()).toBe('denied')
  })

  it('ignores anything that is not a valid choice', () => {
    setConsentChoice('yes' as never)
    expect(document.cookie).not.toContain('tm_consent')
    expect(getConsentChoice()).toBeNull()
  })

  it('keeps the choice for this page when the browser refuses the cookie', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!
    const spy = vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {})
    try {
      setConsentChoice('denied')
      expect(descriptor.get!.call(document)).not.toContain('tm_consent')
      expect(getConsentChoice()).toBe('denied')
    } finally {
      spy.mockRestore()
    }
  })

  it('lets a valid cookie override the in-page choice', () => {
    setConsentChoice('denied')
    document.cookie = 'tm_consent=granted; Path=/'
    expect(getConsentChoice()).toBe('granted')
  })

  it('notifies subscribers on a choice and on opening the settings, until they unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeConsent(listener)
    openCookieSettings()
    expect(isCookieSettingsOpen()).toBe(true)
    openCookieSettings() // already open: no news
    expect(listener).toHaveBeenCalledTimes(1)
    setConsentChoice('granted')
    expect(isCookieSettingsOpen()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    setConsentChoice('denied')
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('deleteCookies', () => {
  it('deletes only the cookies whose names match', () => {
    document.cookie = '_ga=GA1.1.123; Path=/'
    document.cookie = '_ga_ABC123=GS1.1; Path=/'
    document.cookie = 'NEXT_LOCALE=de; Path=/'
    deleteCookies(/^_ga(_[A-Za-z0-9]+)?$/)
    expect(document.cookie).not.toContain('_ga')
    expect(document.cookie).toContain('NEXT_LOCALE=de')
  })

  it('also expires the cookie on each parent domain', () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'www.tabmerger.com' })
    const writes: string[] = []
    const spy = vi.spyOn(document, 'cookie', 'set').mockImplementation((value: string) => {
      writes.push(value)
    })
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('_ga=1; other=2')
    try {
      deleteCookies(/^_ga$/)
      expect(writes).toEqual([
        '_ga=; Max-Age=0; Path=/',
        '_ga=; Max-Age=0; Path=/; Domain=www.tabmerger.com',
        '_ga=; Max-Age=0; Path=/; Domain=tabmerger.com',
      ])
    } finally {
      spy.mockRestore()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })
})
