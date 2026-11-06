/**
 * lib/memoryRateLimit.ts: the per-instance, in-memory limiter behind the /api/track and
 * /api/og-preview per-IP limits. Fixed epoch-aligned windows, several limits counted at once, a
 * refused hit counting nowhere, and the key cap (expired keys first, then least recently used).
 * Every call passes its own clock, so nothing here depends on the real time.
 */
import { describe, it, expect } from 'vitest'
import { createMemoryRateLimiter } from '@/lib/memoryRateLimit'

/** 10:00:00 UTC on an arbitrary day: the start of a minute and of an hour window. */
const T0 = Date.UTC(2026, 10, 5, 10, 0, 0)

describe('createMemoryRateLimiter', () => {
  it('allows up to max hits in a window and reports the counts', () => {
    const limiter = createMemoryRateLimiter([{ windowSeconds: 60, max: 3 }])
    expect(limiter.take('a', T0)).toEqual({ kind: 'allowed', counts: [1] })
    expect(limiter.take('a', T0 + 1000)).toEqual({ kind: 'allowed', counts: [2] })
    expect(limiter.take('a', T0 + 2000)).toEqual({ kind: 'allowed', counts: [3] })
    expect(limiter.take('a', T0 + 3000)).toEqual({ kind: 'limited', retryAfterSeconds: 57 })
  })

  it('starts again at zero in the next window', () => {
    const limiter = createMemoryRateLimiter([{ windowSeconds: 60, max: 1 }])
    expect(limiter.take('a', T0 + 59_000).kind).toBe('allowed')
    expect(limiter.take('a', T0 + 59_500)).toEqual({ kind: 'limited', retryAfterSeconds: 1 })
    expect(limiter.take('a', T0 + 60_000)).toEqual({ kind: 'allowed', counts: [1] })
  })

  it('keeps keys apart', () => {
    const limiter = createMemoryRateLimiter([{ windowSeconds: 60, max: 1 }])
    expect(limiter.take('a', T0).kind).toBe('allowed')
    expect(limiter.take('b', T0).kind).toBe('allowed')
    expect(limiter.take('a', T0).kind).toBe('limited')
  })

  it('counts every limit at once and waits for the longest full one', () => {
    const limiter = createMemoryRateLimiter([
      { windowSeconds: 60, max: 2 },
      { windowSeconds: 3600, max: 3 },
    ])
    expect(limiter.take('a', T0)).toEqual({ kind: 'allowed', counts: [1, 1] })
    expect(limiter.take('a', T0)).toEqual({ kind: 'allowed', counts: [2, 2] })
    expect(limiter.take('a', T0).kind).toBe('limited')
    // Next minute: the minute window has room again, the hour window has one hit left.
    expect(limiter.take('a', T0 + 60_000)).toEqual({ kind: 'allowed', counts: [1, 3] })
    // Hour full: the wait runs to the end of the hour, not the minute.
    expect(limiter.take('a', T0 + 61_000)).toEqual({ kind: 'limited', retryAfterSeconds: 3600 - 61 })
  })

  it('counts a refused hit nowhere', () => {
    const limiter = createMemoryRateLimiter([
      { windowSeconds: 60, max: 1 },
      { windowSeconds: 3600, max: 2 },
    ])
    expect(limiter.take('a', T0).kind).toBe('allowed')
    // Refused by the minute window: must not use up the hour window's second hit.
    expect(limiter.take('a', T0 + 1000).kind).toBe('limited')
    expect(limiter.take('a', T0 + 1000).kind).toBe('limited')
    expect(limiter.take('a', T0 + 60_000)).toEqual({ kind: 'allowed', counts: [1, 2] })
  })

  it('handles window lengths that are not multiples of each other', () => {
    const limiter = createMemoryRateLimiter([
      { windowSeconds: 7, max: 1 },
      { windowSeconds: 10, max: 5 },
    ])
    expect(limiter.take('a', 14_000).kind).toBe('allowed')
    expect(limiter.take('a', 20_500)).toEqual({ kind: 'limited', retryAfterSeconds: 1 })
    expect(limiter.take('a', 21_000)).toEqual({ kind: 'allowed', counts: [1, 1] })
  })

  it('holds at most maxKeys, dropping expired keys first', () => {
    const limiter = createMemoryRateLimiter([{ windowSeconds: 60, max: 1 }], { maxKeys: 10 })
    for (let i = 0; i < 10; i++) limiter.take(`old-${i}`, T0)
    expect(limiter.size()).toBe(10)
    // A minute later every old key has expired, so the sweep clears them all.
    limiter.take('new', T0 + 60_000)
    expect(limiter.size()).toBe(1)
  })

  it('evicts the least recently used keys when none has expired', () => {
    const limiter = createMemoryRateLimiter([{ windowSeconds: 3600, max: 2 }], { maxKeys: 10 })
    for (let i = 0; i < 10; i++) limiter.take(`k${i}`, T0)
    // k0 is used again, so it is now the most recent; k1 is the least recent.
    expect(limiter.take('k0', T0)).toEqual({ kind: 'allowed', counts: [2] })
    limiter.take('k10', T0)
    expect(limiter.size()).toBeLessThanOrEqual(10)
    // k0 survived the eviction and is still counted; k1 was evicted and starts again at zero.
    expect(limiter.take('k0', T0).kind).toBe('limited')
    expect(limiter.take('k1', T0)).toEqual({ kind: 'allowed', counts: [1] })
  })

  it('uses the real clock when no time is given', () => {
    const limiter = createMemoryRateLimiter([{ windowSeconds: 60, max: 1 }])
    expect(limiter.take('a').kind).toBe('allowed')
  })

  it('rejects limits it cannot enforce', () => {
    expect(() => createMemoryRateLimiter([])).toThrow()
    expect(() => createMemoryRateLimiter([{ windowSeconds: 0, max: 1 }])).toThrow()
    expect(() => createMemoryRateLimiter([{ windowSeconds: 60, max: 0 }])).toThrow()
    expect(() => createMemoryRateLimiter([{ windowSeconds: 60, max: 1 }], { maxKeys: 0 })).toThrow()
  })
})
