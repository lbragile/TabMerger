/**
 * Tests for lib/sentry-scrubber.ts — strips tab URLs (PII) from Sentry events before send.
 */
import { describe, it, expect } from 'vitest'
import { scrubEvent } from '@/lib/sentry-scrubber'
import type { ErrorEvent } from '@sentry/nextjs'

describe('scrubEvent', () => {
  it('redacts the request URL and headers when present', () => {
    const event = {
      request: { url: 'https://example.com/secret-tab', headers: { cookie: 'x' } },
    } as unknown as ErrorEvent
    const result = scrubEvent(event)
    expect(result?.request?.url).toBe('[redacted]')
    expect(result?.request?.headers).toEqual({})
  })

  it('redacts breadcrumb data urls when present', () => {
    const event = {
      breadcrumbs: [{ data: { url: 'https://example.com/a', from: '/a', to: '/b' } }],
    } as unknown as ErrorEvent
    const result = scrubEvent(event)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bc = (result?.breadcrumbs as any)[0]
    expect(bc.data).toEqual({ url: '[redacted]', from: '[redacted]', to: '[redacted]' })
  })

  it('leaves breadcrumbs without data untouched', () => {
    const event = { breadcrumbs: [{ message: 'clicked' }] } as unknown as ErrorEvent
    const result = scrubEvent(event)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result?.breadcrumbs as any)[0].data).toBeUndefined()
  })

  it('passes through an event with neither request nor breadcrumbs unchanged', () => {
    const event = { message: 'hi' } as unknown as ErrorEvent
    const result = scrubEvent(event)
    expect(result).toBe(event)
  })
})
