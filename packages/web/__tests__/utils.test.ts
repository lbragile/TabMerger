import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cn, formatDate, formatCurrency, absoluteUrl } from '@/lib/utils'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('deduplicates conflicting Tailwind classes (last wins)', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('handles falsy values', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c')
  })
})

describe('formatDate', () => {
  it('formats a date string', () => {
    // Use local Date constructor to avoid UTC-midnight timezone shifts
    const result = formatDate(new Date(2024, 0, 15))
    expect(result).toContain('2024')
    expect(result).toContain('January')
    expect(result).toContain('15')
  })

  it('formats a Date object', () => {
    const result = formatDate(new Date(2024, 5, 1))
    expect(result).toContain('June')
  })
})

describe('formatCurrency', () => {
  it('formats USD by default', () => {
    expect(formatCurrency(3.99)).toBe('$3.99')
  })

  it('formats other currencies', () => {
    const result = formatCurrency(10, 'EUR')
    expect(result).toContain('10')
  })

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00')
  })
})

describe('absoluteUrl', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://tabmerger.app'
  })

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it('prepends the app URL', () => {
    expect(absoluteUrl('/pricing')).toBe('https://tabmerger.app/pricing')
  })
})
