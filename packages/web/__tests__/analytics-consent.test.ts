import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { act, render } from '@testing-library/react'
import { GTAG_SCRIPT_ID, loadGoogleAnalytics, trackEvent, updateGoogleAnalyticsConsent } from '@/lib/analytics'
import { ConsentedGoogleAnalytics } from '@/components/consent/ConsentedGoogleAnalytics'
import { resetConsentStateForTests, setConsentChoice } from '@/lib/consent'

const GA_ID = 'G-TEST12345'

/** The commands queued for gtag.js, as plain arrays (each entry is an `arguments` object). */
function commands(): unknown[][] {
  return (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>))
}

function clearCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
  }
}

beforeEach(() => {
  delete window.gtag
  delete window.dataLayer
  document.getElementById(GTAG_SCRIPT_ID)?.remove()
})

afterEach(() => {
  clearCookies()
})

describe('loadGoogleAnalytics', () => {
  it('queues the Consent Mode defaults (all denied) before js and config, then adds gtag.js once', () => {
    expect(loadGoogleAnalytics(GA_ID, null)).toBe(true)
    const queued = commands()
    expect(queued[0]).toEqual([
      'consent',
      'default',
      { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' },
    ])
    expect(queued.map((c) => c[0])).toEqual(['consent', 'js', 'config'])
    expect(queued[2]).toEqual(['config', GA_ID])
    // gtag.js only runs commands queued as `arguments` objects, not arrays.
    expect(Array.isArray(window.dataLayer![0])).toBe(false)

    const script = document.getElementById(GTAG_SCRIPT_ID) as HTMLScriptElement
    expect(script.src).toBe(`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`)
    expect(script.async).toBe(true)

    expect(loadGoogleAnalytics(GA_ID, null)).toBe(true)
    expect(document.querySelectorAll(`#${GTAG_SCRIPT_ID}`)).toHaveLength(1)
    expect(commands()).toHaveLength(3)
  })

  it('grants analytics storage, after the denied default and before config, for a stored Accept', () => {
    loadGoogleAnalytics(GA_ID, 'granted')
    expect(commands().slice(0, 4)).toEqual([
      expect.arrayContaining(['consent', 'default']),
      ['consent', 'update', { analytics_storage: 'granted' }],
      ['js', expect.any(Date)],
      ['config', GA_ID],
    ])
  })

  it('never grants anything for a stored Reject, and removes cookies GA set before', () => {
    document.cookie = '_ga=GA1.1.1; Path=/'
    document.cookie = '_ga_TEST12345=GS1; Path=/'
    loadGoogleAnalytics(GA_ID, 'denied')
    expect(commands().filter((c) => c[1] === 'update')).toEqual([])
    expect(document.cookie).not.toContain('_ga')
  })

  it.each(['', 'UA-1234-1', 'G-abc"><script>', 'G-', 'G-TEST12345?x=1'])('refuses the measurement ID %j', (id) => {
    expect(loadGoogleAnalytics(id, 'granted')).toBe(false)
    expect(document.getElementById(GTAG_SCRIPT_ID)).toBeNull()
    expect(window.gtag).toBeUndefined()
  })
})

describe('updateGoogleAnalyticsConsent', () => {
  it('does nothing before GA has loaded', () => {
    expect(() => updateGoogleAnalyticsConsent('granted')).not.toThrow()
    expect(window.dataLayer).toBeUndefined()
  })

  it('grants on Accept and denies (deleting GA cookies) on Reject', () => {
    loadGoogleAnalytics(GA_ID, null)
    updateGoogleAnalyticsConsent('granted')
    expect(commands().at(-1)).toEqual(['consent', 'update', { analytics_storage: 'granted' }])

    document.cookie = '_ga=GA1.1.1; Path=/'
    updateGoogleAnalyticsConsent('denied')
    expect(commands().at(-1)).toEqual(['consent', 'update', { analytics_storage: 'denied' }])
    expect(document.cookie).not.toContain('_ga')
  })
})

describe('trackEvent under Consent Mode', () => {
  it.each([null, 'granted', 'denied'] as const)('still queues events when the choice is %s', (choice) => {
    loadGoogleAnalytics(GA_ID, choice)
    trackEvent('cta_click', { location: 'hero' })
    expect(commands().at(-1)).toEqual(['event', 'cta_click', expect.objectContaining({ location: 'hero' })])
  })
})

describe('the ga-disable switch', () => {
  const flag = () => (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]
  })

  it('is set on Reject and cleared on a later Accept, when given the measurement ID', () => {
    loadGoogleAnalytics(GA_ID, 'granted')
    updateGoogleAnalyticsConsent('denied', GA_ID)
    expect(flag()).toBe(true)
    updateGoogleAnalyticsConsent('granted', GA_ID)
    expect(flag()).toBe(false)
  })

  it('is never set for a malformed measurement ID', () => {
    loadGoogleAnalytics(GA_ID, 'granted')
    updateGoogleAnalyticsConsent('denied', 'G-abc"><script>')
    expect(Object.keys(window).filter((k) => k.startsWith('ga-disable-'))).toEqual([])
  })
})

describe('ConsentedGoogleAnalytics by region and Global Privacy Control', () => {
  const setGpc = (value: boolean) => Object.defineProperty(navigator, 'globalPrivacyControl', { value, configurable: true })
  afterEach(() => {
    resetConsentStateForTests()
    delete (navigator as unknown as Record<string, unknown>).globalPrivacyControl
    delete (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]
  })

  it('loads nothing in an opt-in region (or with no region cookie) until Accept', () => {
    render(createElement(ConsentedGoogleAnalytics, { gaId: GA_ID }))
    expect(document.getElementById(GTAG_SCRIPT_ID)).toBeNull()
    expect(window.dataLayer).toBeUndefined()
    act(() => setConsentChoice('granted'))
    expect(document.getElementById(GTAG_SCRIPT_ID)).toBeInTheDocument()
  })

  it('loads gtag.js with analytics storage granted in an opt-out region, without a click', () => {
    document.cookie = 'tm_consent_region=optout; Path=/'
    render(createElement(ConsentedGoogleAnalytics, { gaId: GA_ID }))
    expect(document.getElementById(GTAG_SCRIPT_ID)).toBeInTheDocument()
    expect(commands()).toContainEqual(['consent', 'update', { analytics_storage: 'granted' }])
  })

  it('stops sending and clears GA cookies on a Reject in an opt-out region', () => {
    document.cookie = 'tm_consent_region=optout; Path=/'
    render(createElement(ConsentedGoogleAnalytics, { gaId: GA_ID }))
    document.cookie = '_ga=GA1.1.1; Path=/'
    act(() => setConsentChoice('denied'))
    expect(commands().at(-1)).toEqual(['consent', 'update', { analytics_storage: 'denied' }])
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]).toBe(true)
    expect(document.cookie).not.toContain('_ga=')
  })

  it.each(['optin', 'optout'])('loads nothing under Global Privacy Control (%s region)', (region) => {
    document.cookie = `tm_consent_region=${region}; Path=/`
    setGpc(true)
    render(createElement(ConsentedGoogleAnalytics, { gaId: GA_ID }))
    expect(document.getElementById(GTAG_SCRIPT_ID)).toBeNull()
  })

  it('does not load after a stored Reject in an opt-out region', () => {
    document.cookie = 'tm_consent_region=optout; Path=/'
    document.cookie = 'tm_consent=denied; Path=/'
    render(createElement(ConsentedGoogleAnalytics, { gaId: GA_ID }))
    expect(document.getElementById(GTAG_SCRIPT_ID)).toBeNull()
  })
})
