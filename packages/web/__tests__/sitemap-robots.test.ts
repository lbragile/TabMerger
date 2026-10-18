import { afterEach, describe, expect, it, vi } from 'vitest'
import robots from '@/app/robots'
import { DEFAULT_LOCALE, PSEUDO_LOCALE, PUBLIC_LOCALES } from '@/i18n/locales'
import { SUPPORTED_LOCALES } from '@tabmerger/shared'
import sitemap, { ENGLISH_ONLY_PATHS, SITEMAP_PATHS } from '@/app/sitemap'
import { localizedPath } from '@/i18n/locales'
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
    // One entry per page and shipped locale; the English-only legal pages once, in English.
    const expected = ['/', '/features', '/pricing', '/faq', '/changelog', '/privacy', '/terms', '/contact'].flatMap((path) =>
      (ENGLISH_ONLY_PATHS.has(path) ? [DEFAULT_LOCALE] : SUPPORTED_LOCALES).map(
        (locale) => new URL(localizedPath(locale, path), getMetadataBase()).href
      )
    )
    expect(entries.map((entry) => entry.url)).toEqual(expected)
    expect(entries[0].url).toBe('https://example.test/')
    expect(entries.map((entry) => entry.url)).toContain('https://example.test/fr/pricing')
    expect(entries.some((entry) => entry.url.includes(`/${PSEUDO_LOCALE}`))).toBe(false)
    for (const entry of entries) expect(entry).not.toHaveProperty('lastModified')
  })

  it('lists each language version of a page with the same hreflang set, one per shipped locale', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.test')
    const entries = sitemap()
    const href = (locale: string, path: string) => new URL(localizedPath(locale, path), 'https://example.test').href
    for (const path of SITEMAP_PATHS) {
      const locales = ENGLISH_ONLY_PATHS.has(path) ? [DEFAULT_LOCALE] : [...SUPPORTED_LOCALES]
      const languages = Object.fromEntries(locales.map((locale) => [locale, href(locale, path)]))
      for (const locale of locales) {
        const entry = entries.find((e) => e.url === href(locale, path))
        expect(entry, `${locale} ${path}`).toBeDefined()
        expect(entry!.alternates).toEqual({ languages })
      }
    }
    for (const entry of entries) expect(entry.alternates?.languages).not.toHaveProperty(PSEUDO_LOCALE)
  })

  it('lists the English-only legal pages once, without translated versions', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.test')
    const paths = sitemap().map((entry) => new URL(entry.url).pathname)
    for (const path of ENGLISH_ONLY_PATHS) {
      expect(paths.filter((p) => p === path || p.endsWith(path))).toEqual([path])
    }
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
    expect(disallowed.slice(0, 2)).toEqual(['/dashboard', '/account'])
    expect(disallowed).toContain('/api/')
  })

  it('also keeps the app out under every other public locale prefix', () => {
    const rules = robots().rules
    const disallowed = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) => rule.disallow ?? [])
    for (const locale of PUBLIC_LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
      expect(disallowed).toContain(`/${locale}/dashboard`)
      expect(disallowed).toContain(`/${locale}/account`)
    }
    expect(disallowed).not.toContain(`/${DEFAULT_LOCALE}/dashboard`)
    expect(new Set(disallowed).size).toBe(disallowed.length)
  })

  it('never lists the dev-only pseudo-locale', () => {
    const rules = robots().rules
    const disallowed = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) => rule.disallow ?? [])
    expect(disallowed.some((path) => path.startsWith(`/${PSEUDO_LOCALE}/`))).toBe(false)
  })
})
