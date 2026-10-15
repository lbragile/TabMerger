/**
 * Unit tests for POST /api/uninstall-feedback — field-by-field validation, the
 * honeypot, rate limiting, the email it builds, and PII-free logging. `resend`
 * is mocked, so no test ever sends a real email.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { UNINSTALL_SURVEY_LIMITS, UNINSTALL_SURVEY_REASONS } from '@tabmerger/shared'

const sendMock = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function (this: { emails: { send: typeof sendMock } }) {
    this.emails = { send: sendMock }
  }),
}))

// Every request gets its own IP unless a test sets one, so the per-IP limiter
// only matters in the rate-limit tests.
let ipCounter = 0
const nextIp = () => `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`

function req(body: unknown, ip = nextIp(), headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/uninstall-feedback', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const validBody = {
  reasons: ['bug', 'slow'],
  details: 'The popup froze twice.',
  email: 'user@example.com',
  version: '3.1.2',
  browser: 'chrome',
  channel: 'stable',
}

type Sent = { to: string; from: string; subject: string; text: string; replyTo?: string }
const sent = () => sendMock.mock.calls[0][0] as Sent

async function post(body: unknown, ip?: string, headers?: Record<string, string>) {
  const { POST } = await import('@/app/api/uninstall-feedback/route')
  return POST(req(body, ip, headers))
}

beforeEach(() => {
  vi.clearAllMocks()
  sendMock.mockResolvedValue({ data: { id: 'abc' }, error: null })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/uninstall-feedback', () => {
  it('sends the answer on the happy path', async () => {
    const res = await post(validBody)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(sendMock).toHaveBeenCalledTimes(1)
    const mail = sent()
    expect(mail.to).toBe('tabmerger.support@gmail.com')
    expect(mail.from).toBe('TabMerger Support <onboarding@resend.dev>')
    expect(mail.replyTo).toBe('user@example.com')
    expect(mail.text).toContain('- Something did not work (bug)')
    expect(mail.text).toContain('- It slowed my browser down (slow)')
    expect(mail.text).toContain('The popup froze twice.')
    expect(mail.text).toContain('Reply to: user@example.com')
    expect(mail.text).toContain('Extension version: 3.1.2')
    expect(mail.text).toContain('Extension browser: chrome')
    expect(mail.text).toContain('Release channel: stable')
  })

  it('accepts reasons only, with no text and no email', async () => {
    const res = await post({ reasons: ['price'] })
    expect(res.status).toBe(200)
    const mail = sent()
    expect(mail.replyTo).toBeUndefined()
    expect(mail.text).toContain('Reply to: none given')
    expect(mail.text).toContain('(nothing written)')
    expect(mail.text).toContain('Extension version: unknown')
  })

  it('accepts text only, with no reasons', async () => {
    const res = await post({ details: 'Just testing it out.' })
    expect(res.status).toBe(200)
    expect(sent().subject).toMatch(/comment only$/)
    expect(sent().text).toContain('(no reason ticked)')
  })

  it('de-duplicates reasons and keeps the order of the shared list', async () => {
    await post({ reasons: ['slow', 'bug', 'slow'] })
    expect(sent().subject).toMatch(/ bug, slow$/)
  })

  it.each([
    ['no reason and no text', { reasons: [], details: '   ' }],
    ['an empty body object', {}],
    ['an unknown reason id', { reasons: ['bug', 'made-up'] }],
    ['a reason that is not a string', { reasons: [1] }],
    ['reasons that are not an array', { reasons: 'bug' }],
    ['too many reasons', { reasons: [...UNINSTALL_SURVEY_REASONS.map((r) => r.id), 'bug'] }],
    ['details that are not a string', { reasons: ['bug'], details: 42 }],
    ['details over the limit', { details: 'a'.repeat(UNINSTALL_SURVEY_LIMITS.details + 1) }],
    ['a malformed email', { reasons: ['bug'], email: 'not-an-email' }],
    ['an email with a header break', { reasons: ['bug'], email: 'a@b.io\r\nBcc: x@y.io' }],
    ['an email over the limit', { reasons: ['bug'], email: `${'a'.repeat(250)}@b.io` }],
    ['an email that is not a string', { reasons: ['bug'], email: ['a@b.io'] }],
    ['a JSON array body', [{ reasons: ['bug'] }]],
    ['a JSON null body', null],
  ])('rejects %s with 400', async (_name, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('rejects a body that is not JSON with 400', async () => {
    const res = await post('{not json')
    expect(res.status).toBe(400)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('accepts details exactly at the limit', async () => {
    const res = await post({ details: 'a'.repeat(UNINSTALL_SURVEY_LIMITS.details) })
    expect(res.status).toBe(200)
  })

  it('rejects an oversized body with 413 before parsing it', async () => {
    const res = await post(JSON.stringify({ details: 'a'.repeat(20_000) }))
    expect(res.status).toBe(413)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('rejects a declared oversized content-length with 413', async () => {
    const res = await post(validBody, undefined, { 'content-length': String(1024 * 1024) })
    expect(res.status).toBe(413)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('ignores unknown keys and drops unrecognised version/browser/channel values', async () => {
    const res = await post({
      reasons: ['bug'],
      version: '<script>alert(1)</script>',
      browser: 'safari',
      channel: 'nightly',
      to: 'attacker@example.com',
      subject: 'Injected subject',
      __proto__: { polluted: true },
    })
    expect(res.status).toBe(200)
    const mail = sent()
    expect(mail.to).toBe('tabmerger.support@gmail.com')
    expect(JSON.stringify(mail)).not.toContain('<script>')
    expect(JSON.stringify(mail)).not.toContain('safari')
    expect(JSON.stringify(mail)).not.toContain('nightly')
    expect(JSON.stringify(mail)).not.toContain('attacker@example.com')
    expect(JSON.stringify(mail)).not.toContain('Injected subject')
    expect(mail.text).toContain('Extension version: unknown')
  })

  it('builds the subject from fixed text, the env tag and reason ids only', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    await post({
      reasons: ['bug'],
      details: 'Subject: hacked\r\nBcc: someone@example.com',
      email: 'user@example.com',
    })
    expect(sent().subject).toBe('[Uninstall][preview] bug')
  })

  it('leaves production subjects untagged', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    await post({ reasons: ['other', 'price'] })
    expect(sent().subject).toBe('[Uninstall] price, other')
  })

  it('strips control and bidi characters from the comment', async () => {
    await post({ details: 'one\u0000two\u0007\r\nthree‮four\u0085' })
    const text = sent().text
    expect(text).toContain('onetwo\nthreefour')
    for (const ch of ['\u0000', '\u0007', '\r', '‮', '\u0085']) expect(text).not.toContain(ch)
  })

  it('rejects a comment that is only control characters', async () => {
    const res = await post({ details: '\u0000\u0001\u0002' })
    expect(res.status).toBe(400)
  })

  it('returns ok without sending when the honeypot is filled', async () => {
    const res = await post({ ...validBody, website: 'https://spam.example' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('appends non-personal diagnostics with no IP and no raw User-Agent', async () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.80 Safari/537.36'
    await post(validBody, '203.0.113.7', {
      'user-agent': ua,
      'accept-language': 'en-CA,en;q=0.9',
      referer: 'https://tabmerger.app/uninstalled?v=3.1.2&b=chrome&c=stable',
    })
    const text = sent().text
    expect(text).toContain('Sent from page: /uninstalled')
    expect(text).toContain('Browser: Chrome 140 on Windows')
    expect(text).toContain('Language: en-CA')
    expect(text).not.toContain('203.0.113.7')
    expect(text).not.toContain(ua)
  })

  describe('recipient', () => {
    it('prefers UNINSTALL_FEEDBACK_TO_EMAIL', async () => {
      vi.stubEnv('UNINSTALL_FEEDBACK_TO_EMAIL', 'uninstall@example.com')
      vi.stubEnv('CONTACT_TO_EMAIL', 'contact@example.com')
      await post(validBody)
      expect(sent().to).toBe('uninstall@example.com')
    })

    it('falls back to CONTACT_TO_EMAIL', async () => {
      vi.stubEnv('UNINSTALL_FEEDBACK_TO_EMAIL', '')
      vi.stubEnv('CONTACT_TO_EMAIL', 'contact@example.com')
      await post(validBody)
      expect(sent().to).toBe('contact@example.com')
    })

    it('falls back to the default support inbox', async () => {
      vi.stubEnv('UNINSTALL_FEEDBACK_TO_EMAIL', '')
      vi.stubEnv('CONTACT_TO_EMAIL', '')
      await post(validBody)
      expect(sent().to).toBe('tabmerger.support@gmail.com')
    })

    it('sends from CONTACT_FROM_EMAIL when set', async () => {
      vi.stubEnv('CONTACT_FROM_EMAIL', 'TabMerger Support <support@example.com>')
      await post(validBody)
      expect(sent().from).toBe('TabMerger Support <support@example.com>')
    })
  })

  it('returns 500 without leaking details when Resend errors, and logs only name/statusCode', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'boom user@example.com', statusCode: 422 },
    })
    const res = await post(validBody)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false })
    expect(errorSpy).toHaveBeenCalledWith('[uninstall-feedback] send failed', { name: 'validation_error', statusCode: 422 })
    const logged = errorSpy.mock.calls.flat().map((a) => JSON.stringify(a)).join(' ')
    expect(logged).not.toContain('user@example.com')
    expect(logged).not.toContain('boom')
    expect(logged).not.toContain(validBody.details)
    errorSpy.mockRestore()
  })

  it('logs a thrown exception without submitted content', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendMock.mockRejectedValue(new TypeError('network down'))
    const res = await post(validBody)
    expect(res.status).toBe(500)
    expect(errorSpy).toHaveBeenCalledWith('[uninstall-feedback] send failed', { name: 'TypeError', statusCode: undefined })
    const logged = errorSpy.mock.calls.flat().map((a) => JSON.stringify(a)).join(' ')
    expect(logged).not.toContain('user@example.com')
    expect(logged).not.toContain(validBody.details)
    errorSpy.mockRestore()
  })

  it('rate limits after 5 requests from the same IP, and not a different IP', async () => {
    const ip = '5.5.5.5'
    for (let i = 0; i < 5; i++) expect((await post(validBody, ip)).status).toBe(200)
    const limited = await post(validBody, ip)
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ ok: false })
    expect((await post(validBody, '7.7.7.7')).status).toBe(200)
  })

  it('does not share its rate limit with the contact route', async () => {
    const ip = '6.6.6.6'
    const contact = await import('@/app/api/contact/route')
    for (let i = 0; i < 5; i++) {
      await contact.POST(
        new NextRequest('http://localhost/api/contact', {
          method: 'POST',
          headers: { 'x-forwarded-for': ip },
          body: JSON.stringify({ email: 'user@example.com', subject: 'Hi', message: 'Hello' }),
        })
      )
    }
    expect((await post(validBody, ip)).status).toBe(200)
  })
})
