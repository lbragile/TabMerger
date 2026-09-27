/**
 * Unit tests for POST /api/contact — validation, rate limiting, and the
 * Resend send call. `resend` is mocked (not real network) — same
 * external-effect-mocking pattern as og-preview-route.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const sendMock = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function (this: { emails: { send: typeof sendMock } }) {
    this.emails = { send: sendMock }
  }),
}))

function req(body: unknown, ip = '1.2.3.4') {
  return new NextRequest('http://localhost/api/contact', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

const validBody = { email: 'user@example.com', subject: 'Hello', message: 'A real message.' }

beforeEach(() => {
  vi.clearAllMocks()
  sendMock.mockResolvedValue({ data: { id: 'abc' }, error: null })
})

describe('POST /api/contact', () => {
  it('rejects an invalid email', async () => {
    const { POST } = await import('@/app/api/contact/route')
    const res = await POST(req({ ...validBody, email: 'not-an-email' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('rejects an empty subject', async () => {
    const { POST } = await import('@/app/api/contact/route')
    const res = await POST(req({ ...validBody, subject: '  ' }))
    expect(res.status).toBe(400)
  })

  it('rejects an empty message', async () => {
    const { POST } = await import('@/app/api/contact/route')
    const res = await POST(req({ ...validBody, message: '' }))
    expect(res.status).toBe(400)
  })

  it('rejects a subject over the max length', async () => {
    const { POST } = await import('@/app/api/contact/route')
    const res = await POST(req({ ...validBody, subject: 'a'.repeat(201) }))
    expect(res.status).toBe(400)
  })

  it('rejects a message over the max length', async () => {
    const { POST } = await import('@/app/api/contact/route')
    const res = await POST(req({ ...validBody, message: 'a'.repeat(5001) }))
    expect(res.status).toBe(400)
  })

  it('sends via Resend with replyTo set to the submitter email on the happy path', async () => {
    const { POST } = await import('@/app/api/contact/route')
    const res = await POST(req(validBody, '9.9.9.9'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'tabmerger.support@gmail.com',
        replyTo: 'user@example.com',
        subject: expect.stringContaining('Hello'),
      })
    )
  })

  it('returns 500 without leaking details when Resend errors', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'boom user@example.com', statusCode: 422 },
    })
    const { POST } = await import('@/app/api/contact/route')
    const res = await POST(req(validBody, '9.9.9.8'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false })
  })

  it('logs the Resend error name/statusCode, never the email or message text', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'boom user@example.com', statusCode: 422 },
    })
    const { POST } = await import('@/app/api/contact/route')
    await POST(req(validBody, '9.9.9.7'))

    expect(errorSpy).toHaveBeenCalledWith('[contact] send failed', { name: 'validation_error', statusCode: 422 })
    const loggedArgs = errorSpy.mock.calls.flat().map((a) => JSON.stringify(a))
    expect(loggedArgs.join(' ')).not.toContain('user@example.com')
    expect(loggedArgs.join(' ')).not.toContain('boom')
    expect(loggedArgs.join(' ')).not.toContain(validBody.message)

    errorSpy.mockRestore()
  })

  it('logs a non-Resend thrown exception without leaking submitted content', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendMock.mockRejectedValue(new TypeError('network down'))
    const { POST } = await import('@/app/api/contact/route')
    await POST(req(validBody, '9.9.9.6'))

    expect(errorSpy).toHaveBeenCalledWith('[contact] send failed', { name: 'TypeError', statusCode: undefined })
    const loggedArgs = errorSpy.mock.calls.flat().map((a) => JSON.stringify(a))
    expect(loggedArgs.join(' ')).not.toContain('user@example.com')
    expect(loggedArgs.join(' ')).not.toContain(validBody.message)

    errorSpy.mockRestore()
  })

  it('rate limits after N requests from the same IP', async () => {
    const { POST } = await import('@/app/api/contact/route')
    const ip = '5.5.5.5'
    for (let i = 0; i < 5; i++) {
      const res = await POST(req(validBody, ip))
      expect(res.status).toBe(200)
    }
    const limited = await POST(req(validBody, ip))
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ ok: false })
  })

  it('does not rate limit a different IP', async () => {
    const { POST } = await import('@/app/api/contact/route')
    for (let i = 0; i < 5; i++) {
      await POST(req(validBody, '6.6.6.6'))
    }
    const res = await POST(req(validBody, '7.7.7.7'))
    expect(res.status).toBe(200)
  })
})
