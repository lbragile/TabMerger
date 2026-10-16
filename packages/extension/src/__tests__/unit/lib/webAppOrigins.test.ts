import { describe, it, expect } from 'vitest'
import {
  parseExtraWebAppOrigin,
  parseExtraWebAppUrls,
  resolveTrustedWebAppOrigins,
  toOriginMatchPatterns,
} from '@/lib/webAppOrigins'

const PROD = { allowLocalhostHttp: false }
const DEV = { allowLocalhostHttp: true }

describe('parseExtraWebAppOrigin', () => {
  it.each([
    ['https://example.com', 'https://example.com'],
    ['https://example.com/', 'https://example.com'],
    ['https://preview.example.com', 'https://preview.example.com'],
    ['HTTPS://Example.COM', 'https://example.com'],
  ])('accepts %s as %s', (entry, origin) => {
    expect(parseExtraWebAppOrigin(entry, PROD)).toBe(origin)
  })

  it.each([
    ['example.com', /not a valid URL/],
    ['not a url', /whitespace/],
    ['http://example.com', /not https/],
    ['ftp://example.com', /not https/],
    ['chrome-extension://abc', /not https/],
    ['https://example.com/app', /has a path/],
    ['https://example.com/app/', /has a path/],
    ['https://example.com?x=1', /has a query/],
    ['https://example.com/?', /has a query/],
    ['https://example.com#top', /has a hash/],
    ['https://example.com/#', /has a hash/],
    ['https://*.example.com', /wildcard/],
    ['https://example.com/*', /wildcard/],
    ['https://user:pass@example.com', /credentials/],
    ['https://user@example.com', /credentials/],
    ['https://example.com:8443', /has a port/],
  ])('rejects %s', (entry, reason) => {
    expect(() => parseExtraWebAppOrigin(entry, PROD)).toThrow(reason)
  })

  it('names the bad entry and the variable in the error', () => {
    expect(() => parseExtraWebAppOrigin('http://example.com', PROD)).toThrow(
      /VITE_EXTRA_WEB_APP_URLS: "http:\/\/example\.com"/
    )
  })

  it('rejects a protocol-only URL with no host', () => {
    expect(() => parseExtraWebAppOrigin('file:///', DEV)).toThrow(/not https/)
  })

  describe('http on localhost', () => {
    it('is rejected outside development builds', () => {
      expect(() => parseExtraWebAppOrigin('http://localhost:3000', PROD)).toThrow(/not https/)
      expect(() => parseExtraWebAppOrigin('http://127.0.0.1:3000', PROD)).toThrow(/not https/)
    })

    it('is accepted in development builds, port included', () => {
      expect(parseExtraWebAppOrigin('http://localhost:3000', DEV)).toBe('http://localhost:3000')
      expect(parseExtraWebAppOrigin('http://127.0.0.1:3000/', DEV)).toBe('http://127.0.0.1:3000')
    })

    it('is still rejected for any other host in development builds', () => {
      expect(() => parseExtraWebAppOrigin('http://example.com', DEV)).toThrow(/not https/)
      expect(() => parseExtraWebAppOrigin('http://localhost.example.com', DEV)).toThrow(/not https/)
    })

    it('still rejects a path on localhost', () => {
      expect(() => parseExtraWebAppOrigin('http://localhost:3000/app', DEV)).toThrow(/has a path/)
    })
  })
})

describe('parseExtraWebAppUrls', () => {
  it('returns [] for unset, empty and blank input', () => {
    expect(parseExtraWebAppUrls(undefined, PROD)).toEqual([])
    expect(parseExtraWebAppUrls('', PROD)).toEqual([])
    expect(parseExtraWebAppUrls('  ,  ', PROD)).toEqual([])
  })

  it('splits on commas and trims whitespace around each entry', () => {
    expect(parseExtraWebAppUrls(' https://a.example.com , https://b.example.com/ ', PROD)).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ])
  })

  it('skips empty entries from stray commas', () => {
    expect(parseExtraWebAppUrls('https://a.example.com,,https://b.example.com,', PROD)).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ])
  })

  it('de-duplicates entries that normalise to the same origin', () => {
    expect(parseExtraWebAppUrls('https://a.example.com,https://A.example.com/', PROD)).toEqual(['https://a.example.com'])
  })

  it('throws on the first invalid entry instead of dropping it', () => {
    expect(() => parseExtraWebAppUrls('https://a.example.com,http://b.example.com', PROD)).toThrow(/b\.example\.com/)
  })
})

describe('resolveTrustedWebAppOrigins', () => {
  it('puts the primary first, then the extras', () => {
    expect(resolveTrustedWebAppOrigins('https://old.example.com', 'https://new.example.com', PROD)).toEqual([
      'https://old.example.com',
      'https://new.example.com',
    ])
  })

  it('reduces the primary to its origin', () => {
    expect(resolveTrustedWebAppOrigins('https://old.example.com/', undefined, PROD)).toEqual(['https://old.example.com'])
  })

  it('keeps an http primary (its existing rules are unchanged)', () => {
    expect(resolveTrustedWebAppOrigins('http://localhost:3000', undefined, PROD)).toEqual(['http://localhost:3000'])
  })

  it('drops an extra that duplicates the primary', () => {
    expect(
      resolveTrustedWebAppOrigins('https://old.example.com', 'https://old.example.com/, https://new.example.com', PROD)
    ).toEqual(['https://old.example.com', 'https://new.example.com'])
  })

  it('returns only the extras when the primary is unset', () => {
    expect(resolveTrustedWebAppOrigins(undefined, 'https://new.example.com', PROD)).toEqual(['https://new.example.com'])
    expect(resolveTrustedWebAppOrigins('', undefined, PROD)).toEqual([])
  })

  it('throws on a primary that is not an http(s) URL', () => {
    expect(() => resolveTrustedWebAppOrigins('example.com', undefined, PROD)).toThrow(/VITE_WEB_APP_URL.*not a valid URL/)
    expect(() => resolveTrustedWebAppOrigins('ftp://example.com', undefined, PROD)).toThrow(/VITE_WEB_APP_URL.*not an http/)
  })

  it('throws on an invalid extra', () => {
    expect(() => resolveTrustedWebAppOrigins('https://old.example.com', 'https://*.example.com', PROD)).toThrow(
      /VITE_EXTRA_WEB_APP_URLS/
    )
  })
})

describe('toOriginMatchPatterns', () => {
  it('appends /* to each origin', () => {
    expect(toOriginMatchPatterns(['https://a.example.com', 'http://localhost:3000'])).toEqual([
      'https://a.example.com/*',
      'http://localhost:3000/*',
    ])
  })
})
