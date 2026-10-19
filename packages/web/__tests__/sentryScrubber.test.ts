/**
 * Tests for lib/sentry-scrubber.ts — strips tab URLs (PII) from Sentry events before send.
 */
import { describe, it, expect } from 'vitest'
import { scrubBreadcrumb, scrubEvent, scrubPreparedEvent, scrubRecordingEvent } from '@/lib/sentry-scrubber'
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
    const bc = (result?.breadcrumbs as any)[0]
    expect(bc.data).toEqual({ url: '[redacted]', from: '[redacted]', to: '[redacted]' })
  })

  it('leaves breadcrumbs without data untouched', () => {
    const event = { breadcrumbs: [{ message: 'clicked' }] } as unknown as ErrorEvent
    const result = scrubEvent(event)
    expect((result?.breadcrumbs as any)[0].data).toBeUndefined()
  })

  it('passes through an event with neither request nor breadcrumbs unchanged', () => {
    const event = { message: 'hi' } as unknown as ErrorEvent
    const result = scrubEvent(event)
    expect(result).toBe(event)
  })
})

const KEYED = 'https://tabmerger.com/share/abc#key=secret'

describe('scrubBreadcrumb', () => {
  it('strips fragments from navigation, fetch and message fields', () => {
    const result = scrubBreadcrumb({
      category: 'navigation',
      message: KEYED,
      data: { from: '/share/abc#key=secret', to: '/de/share/x#key=y', nested: { url: KEYED } },
    })
    expect(result.message).toBe('https://tabmerger.com/share/abc')
    expect(result.data).toEqual({ from: '/share/abc', to: '/de/share/x', nested: { url: 'https://tabmerger.com/share/abc' } })
  })

  it('leaves non-URL text and breadcrumbs without data alone', () => {
    expect(scrubBreadcrumb({ message: 'Group #1' })).toEqual({ message: 'Group #1' })
    expect(scrubBreadcrumb({ category: 'ui.click' })).toEqual({ category: 'ui.click' })
  })
})

describe('scrubRecordingEvent', () => {
  it('strips the page URL from a meta event', () => {
    const result = scrubRecordingEvent({ type: 4, data: { href: KEYED, width: 1 }, timestamp: 1 })
    expect(result.data).toEqual({ href: 'https://tabmerger.com/share/abc', width: 1 })
  })

  it('strips URLs from custom breadcrumb and span payloads', () => {
    const result = scrubRecordingEvent({
      type: 5,
      data: {
        tag: 'performanceSpan',
        payload: { op: 'navigation.push', description: '/share/abc#key=secret', data: { previous: KEYED, size: [1, KEYED] } },
      },
    })
    expect(JSON.stringify(result)).not.toContain('key=secret')
  })

  it('returns DOM snapshot events unchanged', () => {
    const event = { type: 2, data: { node: { href: KEYED } } }
    expect(scrubRecordingEvent(event)).toBe(event)
  })
})

describe('scrubPreparedEvent', () => {
  it('strips fragments from a replay event urls list, request url and referer', () => {
    const event = {
      type: 'replay_event',
      urls: [KEYED, 'https://tabmerger.com/pricing', 3],
      request: { url: KEYED, headers: { Referer: KEYED } },
    } as unknown as Parameters<typeof scrubPreparedEvent>[0]
    scrubPreparedEvent(event)
    expect(event.urls).toEqual(['https://tabmerger.com/share/abc', 'https://tabmerger.com/pricing', 3])
    expect(event.request?.url).toBe('https://tabmerger.com/share/abc')
    expect(event.request?.headers?.Referer).toBe('https://tabmerger.com/share/abc')
  })

  it('leaves an event without urls or request alone', () => {
    const event = { message: 'x' }
    scrubPreparedEvent(event)
    expect(event).toEqual({ message: 'x' })
  })
})
