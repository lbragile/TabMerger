import { describe, it, expect } from 'vitest'
import { compareStamps, sameStamp } from '@/lib/stamp'

describe('server timestamp comparison (instants, microsecond precision)', () => {
  it('treats format variants of one instant as equal: T vs space, Z vs +00:00 vs +00, trailing zeros, missing fraction', () => {
    const variants = [
      '2026-10-02T10:00:00.123456+00:00',
      '2026-10-02 10:00:00.123456+00:00',
      '2026-10-02T10:00:00.123456Z',
      '2026-10-02 10:00:00.123456+00',
      '2026-10-02T10:00:00.123456000+00:00',
    ]
    for (const v of variants) expect(sameStamp(variants[0], v)).toBe(true)
    expect(sameStamp('2026-10-02T10:00:00Z', '2026-10-02T10:00:00.000000+00:00')).toBe(true)
    expect(sameStamp('2026-10-02T10:00:00.5Z', '2026-10-02T10:00:00.500000+00:00')).toBe(true)
  })

  it('applies the UTC offset', () => {
    expect(sameStamp('2026-10-02T12:00:00+02:00', '2026-10-02T10:00:00Z')).toBe(true)
    expect(compareStamps('2026-10-02T12:00:00+02:00', '2026-10-02T10:00:01Z')).toBeLessThan(0)
  })

  it('keeps microseconds that Date would lose', () => {
    expect(sameStamp('2026-10-02T10:00:00.123456Z', '2026-10-02T10:00:00.123457Z')).toBe(false)
    expect(compareStamps('2026-10-02T10:00:00.123457Z', '2026-10-02T10:00:00.123456Z')).toBeGreaterThan(0)
    expect(compareStamps('2026-10-02T10:00:00.123456Z', '2026-10-02T10:00:00.123457Z')).toBeLessThan(0)
  })

  it('orders by instant, not by string', () => {
    // "9" sorts after "10" as a string; as instants 09:59 < 10:00
    expect(compareStamps('2026-10-02T09:59:59Z', '2026-10-02T10:00:00Z')).toBeLessThan(0)
    expect(compareStamps('2026-10-02T10:00:00Z', '2026-10-02T10:00:00.000001Z')).toBeLessThan(0)
  })

  it('falls back to string equality for a stamp it cannot parse', () => {
    expect(sameStamp('garbage', 'garbage')).toBe(true)
    expect(sameStamp('garbage', 'other')).toBe(false)
  })
})
