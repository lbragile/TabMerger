/**
 * lib/analyticsPrivacy.ts: what keeps decrypted tab data, the account email and a share link's
 * `#key=` out of PostHog (session replay, autocapture and event URLs).
 */
import { describe, expect, it } from 'vitest'
import {
  NO_CAPTURE_CLASS,
  REPLAY_BLOCK_SELECTOR,
  isPrivateContentPath,
  scrubPostHogEvent,
  stripFragmentsDeep,
  stripUrlFragment,
  stripUrlOrPathFragment,
} from '@/lib/analyticsPrivacy'

const KEYED = 'https://tabmerger.com/share/abc123#key=SECRETKEY'

describe('stripUrlFragment', () => {
  it('drops everything from the first #', () => {
    expect(stripUrlFragment(KEYED)).toBe('https://tabmerger.com/share/abc123')
    expect(stripUrlFragment('http://localhost:3000/pricing?x=1#faq')).toBe('http://localhost:3000/pricing?x=1')
    expect(stripUrlFragment('HTTPS://tabmerger.com/#a#b')).toBe('HTTPS://tabmerger.com/')
  })

  it('leaves URLs without a fragment, and anything that is not an http(s) URL, as they are', () => {
    expect(stripUrlFragment('https://tabmerger.com/pricing')).toBe('https://tabmerger.com/pricing')
    expect(stripUrlFragment('$direct')).toBe('$direct')
    expect(stripUrlFragment('Group #1')).toBe('Group #1')
    expect(stripUrlFragment('/share/abc#key=x')).toBe('/share/abc#key=x')
  })
})

describe('isPrivateContentPath', () => {
  it.each(['/dashboard', '/dashboard/x', '/account', '/share/abc', '/share/demo', '/de/dashboard', '/fr/share/abc', '/en-XA/account'])(
    '%s is private',
    (path) => {
      expect(isPrivateContentPath(path)).toBe(true)
    }
  )

  it.each(['/', '/pricing', '/de', '/de/pricing', '/sharepoint', '/dashboards', '/privacy', '/xx/dashboard'])(
    '%s is not',
    (path) => {
      expect(isPrivateContentPath(path)).toBe(false)
    }
  )
})

describe('REPLAY_BLOCK_SELECTOR', () => {
  it('blocks no-capture containers and the popups that portal out of them', () => {
    expect(NO_CAPTURE_CLASS).toBe('ph-no-capture')
    document.body.innerHTML = `
      <div class="ph-no-capture" id="a"></div>
      <div data-radix-popper-content-wrapper id="b"></div>
      <div role="dialog" id="c"></div>
      <div role="alertdialog" id="d"></div>
      <main id="e"></main>`
    const blocked = Array.from(document.querySelectorAll(REPLAY_BLOCK_SELECTOR)).map((el) => el.id)
    expect(blocked).toEqual(['a', 'b', 'c', 'd'])
    document.body.innerHTML = ''
  })
})

describe('scrubPostHogEvent', () => {
  const pageview = () => ({
    uuid: '1',
    event: '$pageview',
    properties: {
      $current_url: KEYED,
      $pathname: '/share/abc123',
      $referrer: 'https://tabmerger.com/dashboard#key=OTHER',
      $initial_current_url: KEYED,
      $initial_referrer: '$direct',
      $host: 'tabmerger.com',
      count: 3,
    },
    $set: { $current_url: KEYED, name: 'Group #1' },
    $set_once: { $initial_current_url: KEYED },
  })

  it('passes null through', () => {
    expect(scrubPostHogEvent(null)).toBeNull()
  })

  it('strips the fragment from every URL-valued property, $set and $set_once included', () => {
    const out = scrubPostHogEvent(pageview())!
    expect(JSON.stringify([out.properties.$current_url, out.properties.$referrer, out.properties.$initial_current_url, out.$set, out.$set_once])).not.toMatch(
      /SECRETKEY|OTHER/
    )
    expect(out.properties.$current_url).toBe('https://tabmerger.com/share/abc123')
    expect(out.properties.$referrer).toBe('https://tabmerger.com/dashboard')
    expect(out.$set).toEqual({ $current_url: 'https://tabmerger.com/share/abc123', name: 'Group #1' })
    expect(out.$set_once).toEqual({ $initial_current_url: 'https://tabmerger.com/share/abc123' })
    // Everything else is untouched.
    expect(out.properties.$initial_referrer).toBe('$direct')
    expect(out.properties.count).toBe(3)
    expect(out.event).toBe('$pageview')
  })

  it('does not mutate the event it was given', () => {
    const event = pageview()
    scrubPostHogEvent(event)
    expect(event.properties.$current_url).toBe(KEYED)
  })

  it('keeps pageviews of private pages (their URL is scrubbed, their content never sent)', () => {
    expect(scrubPostHogEvent(pageview())).not.toBeNull()
  })

  it.each(['$autocapture', '$rageclick', '$dead_click', '$copy_autocapture', '$$heatmap'])(
    'drops %s on a private page, by $pathname or $current_url',
    (name) => {
      expect(scrubPostHogEvent({ event: name, properties: { $pathname: '/de/dashboard' } })).toBeNull()
      expect(scrubPostHogEvent({ event: name, properties: { $current_url: KEYED } })).toBeNull()
    }
  )

  it.each(['$autocapture', '$rageclick'])('drops %s when the page is unknown or unparseable', (name) => {
    expect(scrubPostHogEvent({ event: name, properties: {} })).toBeNull()
    expect(scrubPostHogEvent({ event: name, properties: { $current_url: 'not a url' } })).toBeNull()
  })

  it('keeps click events on public pages', () => {
    const out = scrubPostHogEvent({ event: '$autocapture', properties: { $pathname: '/pricing', $current_url: 'https://tabmerger.com/pricing#faq' } })
    expect(out?.properties.$current_url).toBe('https://tabmerger.com/pricing')
  })
})

describe('stripUrlOrPathFragment / stripFragmentsDeep', () => {
  it('strips fragments from site-relative paths and absolute URLs only', () => {
    expect(stripUrlOrPathFragment('/share/a#key=x')).toBe('/share/a')
    expect(stripUrlOrPathFragment('/pricing')).toBe('/pricing')
    expect(stripUrlOrPathFragment('//evil#x')).toBe('//evil#x')
    expect(stripUrlOrPathFragment('Group #1')).toBe('Group #1')
  })

  it('walks nested objects and arrays without mutating them', () => {
    const input = { a: ['/s#k', 1, null], b: { c: 'https://x/y#z' } }
    expect(stripFragmentsDeep(input)).toEqual({ a: ['/s', 1, null], b: { c: 'https://x/y' } })
    expect(input.a[0]).toBe('/s#k')
  })

  it('stops descending past the depth limit', () => {
    let deep: unknown = '/s#k'
    for (let i = 0; i < 12; i++) deep = { n: deep }
    expect(JSON.stringify(stripFragmentsDeep(deep))).toContain('#k')
  })
})
