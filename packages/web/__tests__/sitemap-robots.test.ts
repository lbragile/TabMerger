import { afterEach, describe, expect, it, vi } from 'vitest'
import robots from '@/app/robots'
import sitemap from '@/app/sitemap'
import { getMetadataBase } from '@/lib/utils'

const ENVIRONMENTS = ['production', 'preview', '']

describe('sitemap', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(ENVIRONMENTS)('never lists the beta tester guide (VERCEL_ENV "%s")', (vercelEnv) => {
    vi.stubEnv('VERCEL_ENV', vercelEnv)
    const paths = sitemap().map((entry) => new URL(entry.url).pathname)
    expect(paths).toContain('/pricing')
    expect(paths.filter((path) => path.startsWith('/beta'))).toEqual([])
  })

  it('uses the metadataBase origin and no build-time lastModified', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.test')
    const entries = sitemap()
    expect(entries.map((entry) => entry.url)).toEqual(
      ['/', '/features', '/pricing', '/faq', '/changelog', '/privacy', '/terms', '/contact'].map(
        (path) => new URL(path, getMetadataBase()).href
      )
    )
    expect(entries[0].url).toBe('https://example.test/')
    for (const entry of entries) expect(entry).not.toHaveProperty('lastModified')
  })
})

describe('robots', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(ENVIRONMENTS)('does not block /beta from crawlers (VERCEL_ENV "%s")', (vercelEnv) => {
    // On production /beta answers 404. Crawlers must be allowed to fetch it to see that and drop
    // the URL; a Disallow would keep an already-indexed link listed.
    vi.stubEnv('VERCEL_ENV', vercelEnv)
    const rules = robots().rules
    const disallowed = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) => rule.disallow ?? [])
    expect(disallowed.filter((path) => path.startsWith('/beta'))).toEqual([])
  })

  it('points at the sitemap on the metadataBase origin', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.test')
    expect(robots().sitemap).toBe('https://example.test/sitemap.xml')
  })

  it('lets crawlers fetch the noindex auth and share pages, and keeps the app and API out', () => {
    const rules = robots().rules
    const disallowed = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) => rule.disallow ?? [])
    expect(disallowed).toEqual(['/dashboard', '/account', '/api/'])
  })
})
