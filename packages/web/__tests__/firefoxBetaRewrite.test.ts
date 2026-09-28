/**
 * Unit tests for the /firefox-beta/* -> Vercel Blob rewrite built in next.config.ts.
 *
 * The self-distributed Firefox beta build (.xpi + updates.json) is served from the BETA web
 * app's own domain by rewriting to a public Vercel Blob store base URL configured via
 * FIREFOX_BETA_BLOB_BASE_URL (Preview environment only — see docs/PUBLISHING.md). This only
 * covers the pure helper (firefoxBetaRewrite); it does not exercise Next's actual rewrite/proxy
 * machinery, which isn't something a unit test can meaningfully drive.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  withSentryConfig: (config: unknown) => config,
}))

import { firefoxBetaRewrite } from '../next.config'

describe('firefoxBetaRewrite', () => {
  it('returns null when the base URL is unset', () => {
    expect(firefoxBetaRewrite(undefined)).toBeNull()
  })

  it('returns null for a non-URL string', () => {
    expect(firefoxBetaRewrite('not-a-url')).toBeNull()
  })

  it('returns null for a non-https URL (e.g. http)', () => {
    expect(firefoxBetaRewrite('http://example.public.blob.vercel-storage.com')).toBeNull()
  })

  it('builds a source/destination rewrite for a valid https base URL', () => {
    const result = firefoxBetaRewrite('https://abc123.public.blob.vercel-storage.com')
    expect(result).toEqual({
      source: '/firefox-beta/:file',
      destination: 'https://abc123.public.blob.vercel-storage.com/firefox-beta/:file',
    })
  })

  it('strips a trailing slash from the base URL so the destination has no double slash', () => {
    const result = firefoxBetaRewrite('https://abc123.public.blob.vercel-storage.com/')
    expect(result?.destination).toBe(
      'https://abc123.public.blob.vercel-storage.com/firefox-beta/:file'
    )
  })
})
