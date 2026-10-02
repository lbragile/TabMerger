import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cn, formatDate, formatCurrency, absoluteUrl, getMetadataBase } from '@/lib/utils'

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
  afterEach(() => {
    vi.unstubAllEnvs()
    // vitest.setup.tsx sets a default NEXT_PUBLIC_APP_URL for the whole suite; tests below that
    // need it fully absent delete it directly, so restore that default here rather than relying
    // on vi.unstubAllEnvs() (which only restores to the value at the time of the first stub).
    process.env.NEXT_PUBLIC_APP_URL = 'https://tabmerger.app'
  })

  it('prepends the app URL in production (no VERCEL_ENV)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tabmerger.app')
    expect(absoluteUrl('/pricing')).toBe('https://tabmerger.app/pricing')
  })

  // Previews live at a fixed alias, set as the Preview environment's NEXT_PUBLIC_APP_URL.
  // The deployment's own hashed VERCEL_URL must NOT win: it carries none of the alias's
  // session cookies, so a checkout returning there would look signed out.
  it.each(['preview', 'production'])(
    'uses NEXT_PUBLIC_APP_URL and ignores VERCEL_URL when VERCEL_ENV is %s',
    (env) => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tabmerger-preview.vercel.app')
      vi.stubEnv('VERCEL_ENV', env)
      vi.stubEnv('VERCEL_URL', 'tabmerger-abc123-lbragiles-projects.vercel.app')
      expect(absoluteUrl('/dashboard')).toBe('https://tabmerger-preview.vercel.app/dashboard')
    }
  )

  it('strips a trailing slash from NEXT_PUBLIC_APP_URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tabmerger.app/')
    expect(absoluteUrl('/pricing')).toBe('https://tabmerger.app/pricing')
  })

  it('works for local dev with only NEXT_PUBLIC_APP_URL=http://localhost:3000', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    expect(absoluteUrl('/dashboard')).toBe('http://localhost:3000/dashboard')
  })

  it('rejects a quoted NEXT_PUBLIC_APP_URL value and throws if no fallback', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '"https://tabmerger.app"')
    expect(() => absoluteUrl('/pricing')).toThrow(/could not resolve a base URL/)
  })

  it('rejects a NEXT_PUBLIC_APP_URL value with no scheme', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'tabmerger.app')
    expect(() => absoluteUrl('/pricing')).toThrow(/could not resolve a base URL/)
  })

  it('rejects a placeholder NEXT_PUBLIC_APP_URL value', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '<APP_URL>')
    expect(() => absoluteUrl('/pricing')).toThrow(/could not resolve a base URL/)
  })

  it('rejects a NEXT_PUBLIC_APP_URL value with embedded whitespace', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tab merger.app')
    expect(() => absoluteUrl('/pricing')).toThrow(/could not resolve a base URL/)
  })

  it('rejects a non-http(s) scheme like ftp://', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'ftp://tabmerger.app')
    expect(() => absoluteUrl('/pricing')).toThrow(/could not resolve a base URL/)
  })

  it('throws a helpful error when nothing valid is configured', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(() => absoluteUrl('/pricing')).toThrow(/NEXT_PUBLIC_APP_URL/)
  })

  // Fails CLOSED in every environment. Falling back to the deployment's own *.vercel.app
  // host would send paying customers to a URL that may be behind deployment protection and
  // doesn't carry their session cookies — a loud error beats silently misdirected checkouts.
  it.each([
    ['missing', undefined],
    ['invalid', '"https://tabmerger.app"'],
  ])('does NOT fall back to VERCEL_URL when NEXT_PUBLIC_APP_URL is %s', (_label, value) => {
    if (value === undefined) delete process.env.NEXT_PUBLIC_APP_URL
    else vi.stubEnv('NEXT_PUBLIC_APP_URL', value)
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('VERCEL_URL', 'tabmerger-abc123-lbragiles-projects.vercel.app')
    expect(() => absoluteUrl('/dashboard?upgraded=1')).toThrow(/could not resolve a base URL/)
  })

  // A base URL must be a bare origin. Rejected rather than trimmed, since each of these is
  // a sign the variable was mis-pasted.
  it.each([
    ['userinfo', 'https://evil@tabmerger.app'],
    ['user and password', 'https://user:pass@tabmerger.app'],
    ['a path', 'https://tabmerger.app/app'],
    ['a query string', 'https://tabmerger.app?x=1'],
    ['a fragment', 'https://tabmerger.app#top'],
  ])('rejects a NEXT_PUBLIC_APP_URL containing %s', (_label, value) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', value)
    expect(() => absoluteUrl('/pricing')).toThrow(/could not resolve a base URL/)
  })

  it('keeps a non-default port, which is part of the origin', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000/')
    expect(absoluteUrl('/dashboard')).toBe('http://localhost:3000/dashboard')
  })
})

describe('getMetadataBase', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('prefers NEXT_PUBLIC_APP_URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tabmerger.app')
    expect(getMetadataBase().origin).toBe('https://tabmerger.app')
  })

  it('falls back to the Vercel host, then localhost, without throwing', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    vi.stubEnv('VERCEL_URL', 'x-abc.vercel.app')
    expect(getMetadataBase().origin).toBe('https://x-abc.vercel.app')
    vi.stubEnv('VERCEL_URL', '')
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '')
    expect(getMetadataBase().origin).toBe('http://localhost:3000')
  })
})
