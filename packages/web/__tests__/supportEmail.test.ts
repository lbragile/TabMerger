/**
 * Unit tests for the helpers shared by the support-email routes:
 * lib/supportEmail.ts, lib/emailAddress.ts, lib/plainText.ts, and the
 * uninstall-survey reinstall links in lib/storeLinks.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { STORE_LISTING_URL } from '@tabmerger/shared'
import { EMAIL_MAX, isEmailAddress } from '@/lib/emailAddress'
import { stripControlChars } from '@/lib/plainText'
import {
  DEFAULT_FROM,
  DEFAULT_TO,
  buildDiagnostics,
  createRateLimiter,
  describeBrowser,
  getClientIp,
  isSenderAddress,
  sendSupportEmail,
  supportFromAddress,
  supportToAddress,
} from '@/lib/supportEmail'
import { SUPPORT_EMAIL } from '@/lib/supportInbox'
import { BETA_STORE_LINKS, STABLE_STORE_LINKS, getReinstallLinks } from '@/lib/storeLinks'

const sendMock = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function (this: { emails: { send: typeof sendMock } }) {
    this.emails = { send: sendMock }
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  sendMock.mockResolvedValue({ data: { id: 'abc' }, error: null })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('isEmailAddress', () => {
  it.each(['a@b.c', 'first.last@sub.example.co.uk', 'a+tag@b.io'])('accepts %s', (email) => {
    expect(isEmailAddress(email)).toBe(true)
  })

  it.each(['a@b', 'a@.b', 'a@b.', 'a b@c.d', 'a@b..c', 'a@b.io\nBcc: c@d.io', '', 42, null])(
    'rejects %j',
    (email) => {
      expect(isEmailAddress(email)).toBe(false)
    }
  )

  it('rejects an address over the maximum length', () => {
    expect(isEmailAddress(`${'a'.repeat(EMAIL_MAX)}@b.io`)).toBe(false)
  })
})

describe('stripControlChars', () => {
  it('keeps ordinary text, tabs, newlines and emoji', () => {
    expect(stripControlChars('Hi\tthere\nfriend 👋 é')).toBe('Hi\tthere\nfriend 👋 é')
  })

  it('turns CRLF, CR and Unicode line separators into newlines', () => {
    expect(stripControlChars('a\r\nb\rc d e')).toBe('a\nb\nc\nd\ne')
  })

  it('removes C0/C1 controls, DEL and bidi controls', () => {
    expect(stripControlChars('a\u0000b\u001bc\u007fd\u0085e‮f⁦g‏h')).toBe('abcdefgh')
  })
})

describe('createRateLimiter', () => {
  it('allows max calls per window per key, then frees up after the window', () => {
    vi.useFakeTimers()
    const limited = createRateLimiter(2, 1000)
    expect(limited('a')).toBe(false)
    expect(limited('a')).toBe(false)
    expect(limited('a')).toBe(true)
    expect(limited('b')).toBe(false)
    vi.advanceTimersByTime(1001)
    expect(limited('a')).toBe(false)
  })
})

describe('getClientIp', () => {
  const at = (headers: Record<string, string>) => new NextRequest('http://localhost/x', { headers })
  const ALL = {
    'cf-connecting-ip': '198.51.100.1',
    'x-vercel-forwarded-for': '203.0.113.1',
    'x-real-ip': '203.0.113.2',
    'x-forwarded-for': '203.0.113.3, 5.6.7.8',
  }

  beforeEach(() => {
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('DEPLOY_PLATFORM', '')
  })

  it('off a known platform, takes the first x-forwarded-for address, or "unknown"', () => {
    expect(getClientIp(at({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('4:1.2.3.4')
    expect(getClientIp(at({}))).toBe('unknown')
    expect(getClientIp(at({ 'x-forwarded-for': 'not-an-ip' }))).toBe('unknown')
  })

  it('on Vercel uses the same headers as the AI per-IP limit, in the same order', () => {
    expect(getClientIp(at(ALL), 'vercel')).toBe('4:203.0.113.1')
    expect(getClientIp(at({ 'x-real-ip': '203.0.113.2', 'x-forwarded-for': '203.0.113.3' }), 'vercel')).toBe('4:203.0.113.2')
    vi.stubEnv('VERCEL', '1')
    expect(getClientIp(at(ALL))).toBe('4:203.0.113.1')
  })

  it('on Cloudflare uses only cf-connecting-ip', () => {
    expect(getClientIp(at(ALL), 'cloudflare')).toBe('4:198.51.100.1')
    vi.stubEnv('DEPLOY_PLATFORM', 'cloudflare')
    expect(getClientIp(at(ALL))).toBe('4:198.51.100.1')
  })

  it("can't be given a fresh key per request with the other platform's header", () => {
    // Each request sends a different x-forwarded-for: on Cloudflare they all share one key.
    const keys = ['192.0.2.1', '192.0.2.2', '192.0.2.3'].map((spoof) =>
      getClientIp(at({ 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-for': spoof, 'x-real-ip': spoof, 'x-vercel-forwarded-for': spoof }), 'cloudflare')
    )
    expect(new Set(keys)).toEqual(new Set(['4:198.51.100.1']))
    // A client-sent cf-connecting-ip on Vercel is ignored.
    expect(getClientIp(at({ 'cf-connecting-ip': '192.0.2.9', 'x-real-ip': '203.0.113.2' }), 'vercel')).toBe('4:203.0.113.2')
    // Without the platform's own header there is no address, not a client-chosen one.
    expect(getClientIp(at({ 'x-forwarded-for': '192.0.2.1' }), 'cloudflare')).toBe('unknown')
  })

  it('counts an IPv6 client once per /64', () => {
    expect(getClientIp(at({ 'cf-connecting-ip': '2001:db8:aa:bb::1' }), 'cloudflare')).toBe('6:2001:db8:aa:bb::/64')
    expect(getClientIp(at({ 'cf-connecting-ip': '2001:db8:aa:bb:1:2:3:4' }), 'cloudflare')).toBe('6:2001:db8:aa:bb::/64')
  })
})

describe('describeBrowser', () => {
  it.each([
    [null, 'unknown'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0', 'Edge 140 on Windows'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox 131 on Linux'],
    ['curl/8.0', 'unknown browser on unknown OS'],
  ])('describes %j as %s', (ua, expected) => {
    expect(describeBrowser(ua)).toBe(expected)
  })
})

describe('buildDiagnostics', () => {
  it('tags non-production subjects and leaves production untagged', () => {
    const req = new NextRequest('http://localhost/api/x')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(buildDiagnostics(req).envTag).toBe('[preview]')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(buildDiagnostics(req).envTag).toBe('')
    // DEPLOY_ENV wins over VERCEL_ENV.
    vi.stubEnv('DEPLOY_ENV', 'preview')
    expect(buildDiagnostics(req).envTag).toBe('[preview]')
  })

  it('reads the commit from DEPLOY_COMMIT_SHA / DEPLOY_COMMIT_REF, falling back to Vercel', () => {
    const req = new NextRequest('http://localhost/api/x')
    vi.stubEnv('DEPLOY_COMMIT_SHA', '')
    vi.stubEnv('DEPLOY_COMMIT_REF', '')
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abcdef1234')
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'main')
    expect(buildDiagnostics(req).text).toContain('Commit: abcdef1 (main)')
    vi.stubEnv('DEPLOY_COMMIT_SHA', '1234567fff')
    vi.stubEnv('DEPLOY_COMMIT_REF', 'beta')
    expect(buildDiagnostics(req).text).toContain('Commit: 1234567 (beta)')
  })

  it('reports an unknown page for a malformed Referer', () => {
    const req = new NextRequest('http://localhost/api/x', { headers: { referer: 'not a url' } })
    expect(buildDiagnostics(req).text).toContain('Sent from page: unknown')
  })
})

describe('support addresses from env', () => {
  it('defaults to the public support inbox on tabmerger.com', () => {
    vi.stubEnv('CONTACT_TO_EMAIL', '')
    vi.stubEnv('CONTACT_FROM_EMAIL', '')
    expect(SUPPORT_EMAIL).toBe('support@tabmerger.com')
    expect(DEFAULT_TO).toBe(SUPPORT_EMAIL)
    expect(DEFAULT_FROM).toBe(`TabMerger Support <${SUPPORT_EMAIL}>`)
    expect(supportToAddress('CONTACT_TO_EMAIL')).toBe(DEFAULT_TO)
    expect(supportFromAddress()).toBe(DEFAULT_FROM)
  })

  it.each(['a@b.io', 'TabMerger Support <a@b.io>', 'O’Brien Help <a@b.io>'])('accepts the sender %s', (value) => {
    expect(isSenderAddress(value)).toBe(true)
  })

  it.each([
    'not an address',
    'Name <not an address>',
    ' <a@b.io>',
    'Name a@b.io',
    'Na"me <a@b.io>',
    'Name <a@b.io> <c@d.io>',
    'Name\r\nBcc: x@evil.io <a@b.io>',
    `${'n'.repeat(65)} <a@b.io>`,
  ])('rejects the sender %j', (value) => {
    expect(isSenderAddress(value)).toBe(false)
  })

  it('uses a valid, trimmed CONTACT_FROM_EMAIL', () => {
    vi.stubEnv('CONTACT_FROM_EMAIL', '  Help <help@example.com>  ')
    expect(supportFromAddress()).toBe('Help <help@example.com>')
  })

  it('falls back from an invalid CONTACT_FROM_EMAIL and warns without the value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('CONTACT_FROM_EMAIL', 'Help\n<private@example.com>')
    expect(supportFromAddress()).toBe(DEFAULT_FROM)
    expect(warn).toHaveBeenCalledWith('[supportEmail] ignoring invalid CONTACT_FROM_EMAIL')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private@example.com')
    warn.mockRestore()
  })

  it('takes the first valid inbox in order, skipping empty and invalid ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('FIRST', '')
    vi.stubEnv('SECOND', 'Name <a@b.io>')
    vi.stubEnv('THIRD', 'inbox@example.com')
    expect(supportToAddress('FIRST', 'SECOND', 'THIRD')).toBe('inbox@example.com')
    expect(warn).toHaveBeenCalledTimes(1)
    vi.stubEnv('THIRD', 'a@b.io,c@d.io')
    expect(supportToAddress('FIRST', 'SECOND', 'THIRD')).toBe(DEFAULT_TO)
    warn.mockRestore()
  })
})

describe('sendSupportEmail', () => {
  it('sends from the default sender and omits replyTo when none is given', async () => {
    expect(await sendSupportEmail('t', { to: 'inbox@example.com', subject: 's', text: 'x' })).toBe(true)
    const args = sendMock.mock.calls[0][0]
    expect(args.from).toBe(DEFAULT_FROM)
    expect(args).not.toHaveProperty('replyTo')
  })

  it('answers false and logs only the error shape when Resend refuses', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendMock.mockResolvedValue({ data: null, error: { name: 'x', message: 'secret@example.com', statusCode: 403 } })
    expect(await sendSupportEmail('t', { to: 'a@b.io', subject: 's', text: 'body text' })).toBe(false)
    expect(spy).toHaveBeenCalledWith('[t] send failed', { name: 'x', statusCode: 403 })
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret@example.com')
    spy.mockRestore()
  })

  it('answers false when something non-Error is thrown', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendMock.mockRejectedValue('nope')
    expect(await sendSupportEmail('t', { to: 'a@b.io', subject: 's', text: 'x' })).toBe(false)
    expect(spy).toHaveBeenCalledWith('[t] send failed', { name: 'UnknownError', statusCode: undefined })
    spy.mockRestore()
  })
})

describe('getReinstallLinks', () => {
  it('returns only the given browser, from the stable listings for the stable channel', () => {
    expect(getReinstallLinks('edge', 'stable')).toEqual([{ browser: 'edge', href: STORE_LISTING_URL.EDGE_STABLE }])
  })

  it('uses the beta builds for the beta channel off production', () => {
    expect(getReinstallLinks('chrome', 'beta')).toEqual([{ browser: 'chrome', href: BETA_STORE_LINKS.chrome }])
  })

  it('uses the public listings for the beta channel on production', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(getReinstallLinks('firefox', 'beta')).toEqual([{ browser: 'firefox', href: STABLE_STORE_LINKS.firefox }])
  })

  it('returns all three browsers, from this deployment, when nothing is known', () => {
    expect(getReinstallLinks(undefined, undefined).map((l) => l.href)).toEqual([
      BETA_STORE_LINKS.chrome,
      BETA_STORE_LINKS.firefox,
      BETA_STORE_LINKS.edge,
    ])
  })
})
