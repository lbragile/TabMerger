import { afterEach, describe, expect, it, vi } from 'vitest'
import robots from '@/app/robots'
import sitemap from '@/app/sitemap'

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
})
