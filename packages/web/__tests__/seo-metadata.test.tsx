/**
 * Search and social-preview metadata: the `pageMetadata()` helper, every indexable page's own
 * title / description / canonical / Open Graph / Twitter card, the homepage JSON-LD and its
 * escaping, noindex on the pages that must not be listed, and the preview-only noindex header.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Metadata } from 'next'
import { createTranslator } from 'next-intl'
import { FREE_TIER_LIMITS, PRICING_TIERS, STORE_LISTING_URL, SUPPORTED_LOCALES, getPricingTier } from '@tabmerger/shared'
import { DEFAULT_LOCALE, PSEUDO_LOCALE, localizedPath } from '@/i18n/locales'
import { NOINDEX, PRO_AI_BYOK_OFFER_NAME, faqJsonLd, homeJsonLd, pageMetadata, serializeJsonLd } from '@/lib/seo'
import { FAQ_KEYS, faqItems } from '@/lib/faq'
import { GITHUB_REPO_URL } from '@/lib/github'
import { AI_AVAILABILITY } from '@/lib/aiFlag'
import en from '@/messages/en'
import { JsonLd } from '@/components/seo/JsonLd'
import { isPreviewDeployment } from '@/lib/deployment'

vi.mock('@sentry/nextjs', () => ({ withSentryConfig: (config: unknown) => config }))

const appDir = join(__dirname, '..', 'app')

// The English copy, from the catalog the pages read.
const HOME_TITLE = en.metadata.homeTitle
const SITE_DESCRIPTION = en.metadata.siteDescription
const SOCIAL_IMAGE_ALT = en.metadata.socialImageAlt
/**
 * hreflang alternates for a translated page: one per shipped locale (`/fr/pricing` for French,
 * unprefixed English) plus `x-default` on the English URL. Never the pseudo-locale.
 */
const localeAlternates = (path: string) => ({
  canonical: path,
  languages: {
    ...Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, localizedPath(locale, path)])),
    'x-default': path,
  },
})

/** Alternates for an English-only page: its English URL and x-default, under every locale. */
const englishOnlyAlternates = (path: string) => ({ canonical: path, languages: { en: path, 'x-default': path } })
const ENGLISH_ONLY = new Set(['/privacy', '/terms'])

describe('pageMetadata', async () => {
  const meta = await pageMetadata({ path: '/features', title: 'Features', description: 'All the features.' })

  it('sets the title (for the template), description, a relative canonical and hreflang alternates', () => {
    expect(meta.title).toBe('Features')
    expect(meta.description).toBe('All the features.')
    expect(meta.alternates).toEqual(localeAlternates('/features'))
  })

  it('tags the cards with the locale and lists every shipped language (never the pseudo-locale) as an alternate', () => {
    expect(meta.openGraph).toMatchObject({ locale: 'en_US' })
    const languages = meta.alternates?.languages ?? {}
    expect(Object.keys(languages).sort()).toEqual([...SUPPORTED_LOCALES, 'x-default'].sort())
    expect(languages).not.toHaveProperty(PSEUDO_LOCALE)
    for (const locale of SUPPORTED_LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
      expect((languages as Record<string, string>)[locale]).toBe(`/${locale}/features`)
    }
  })

  it('gives Open Graph and Twitter the same page title, description and URL', () => {
    expect(meta.openGraph).toMatchObject({
      url: '/features',
      title: 'Features | TabMerger',
      description: 'All the features.',
      siteName: 'TabMerger',
      type: 'website',
    })
    expect(meta.twitter).toMatchObject({
      card: 'summary_large_image',
      title: 'Features | TabMerger',
      description: 'All the features.',
    })
  })

  it('names the social images itself, because a page-level openGraph drops the inherited one', () => {
    expect(meta.openGraph?.images).toEqual([
      { url: '/opengraph-image.png', width: 1280, height: 640, alt: SOCIAL_IMAGE_ALT },
    ])
    expect(meta.twitter?.images).toEqual([
      { url: '/twitter-image.png', width: 1280, height: 640, alt: SOCIAL_IMAGE_ALT },
    ])
  })

  it('uses an absolute title when asked, so the template adds no second brand', async () => {
    const home = await pageMetadata({ path: '/', title: 'Home title', description: 'd', absoluteTitle: true })
    expect(home.title).toEqual({ absolute: 'Home title' })
    expect(home.openGraph).toMatchObject({ title: 'Home title' })
  })

  it.each(['opengraph-image.alt.txt', 'twitter-image.alt.txt'])('alt text matches %s', (file) => {
    expect(readFileSync(join(appDir, file), 'utf8').trim()).toBe(SOCIAL_IMAGE_ALT)
  })
})

/** Indexable public pages: their path, module and expected own title. */
const PAGES: [path: string, load: () => Promise<{ generateMetadata: () => Metadata | Promise<Metadata> }>, title: string][] = [
  ['/features', () => import('@/app/[locale]/(marketing)/features/page'), 'Features'],
  ['/pricing', () => import('@/app/[locale]/(marketing)/pricing/page'), 'Pricing'],
  ['/faq', () => import('@/app/[locale]/(marketing)/faq/page'), 'FAQ'],
  ['/changelog', () => import('@/app/[locale]/(marketing)/changelog/page'), 'Changelog'],
  ['/privacy', () => import('@/app/[locale]/(marketing)/privacy/page'), 'Privacy Policy'],
  ['/terms', () => import('@/app/[locale]/(marketing)/terms/page'), 'Terms of Service'],
  ['/contact', () => import('@/app/[locale]/(marketing)/contact/layout'), 'Contact'],
]

describe('indexable pages', () => {
  it.each(PAGES)('%s has its own title, description, canonical and cards', async (path, load, title) => {
    const metadata = await (await load()).generateMetadata()
    expect(metadata.title).toBe(title)
    // The brand comes from the template; a title that already contains it would show it twice.
    expect(String(metadata.title)).not.toMatch(/TabMerger/)
    expect(typeof metadata.description).toBe('string')
    expect(metadata.description).not.toBe(SITE_DESCRIPTION)
    // The legal pages are English only (the binding text): only the English URL is an alternate.
    expect(metadata.alternates).toEqual(ENGLISH_ONLY.has(path) ? englishOnlyAlternates(path) : localeAlternates(path))
    expect(metadata.openGraph).toMatchObject({ url: path, title: `${title} | TabMerger`, description: metadata.description })
    expect(metadata.twitter).toMatchObject({ title: `${title} | TabMerger`, description: metadata.description })
    expect(metadata.robots).toBeUndefined()
  })

  it('the homepage uses an absolute title, so the brand is not repeated', async () => {
    const metadata = await (await import('@/app/[locale]/(marketing)/page')).generateMetadata()
    expect(metadata.title).toEqual({ absolute: HOME_TITLE })
    expect(metadata.description).toBe(SITE_DESCRIPTION)
    expect(metadata.alternates).toEqual(localeAlternates('/'))
    expect(metadata.openGraph).toMatchObject({ url: '/', title: HOME_TITLE })
    expect(metadata.twitter).toMatchObject({ title: HOME_TITLE })
  })

  it('page descriptions are all different', async () => {
    const descriptions = await Promise.all(PAGES.map(async ([, load]) => (await (await load()).generateMetadata()).description))
    expect(new Set(descriptions).size).toBe(PAGES.length)
  })
})

describe('noindex pages', () => {
  it.each([
    ['auth pages', () => import('@/app/auth/layout')],
    ['share pages', () => import('@/app/[locale]/(marketing)/share/layout')],
  ])('%s are noindex', async (_label, load) => {
    const { metadata } = await load()
    expect(metadata.robots).toEqual(NOINDEX)
    expect(NOINDEX).toEqual({ index: false })
  })
})

describe('homepage JSON-LD', () => {
  const base = new URL('https://example.test')
  const data = homeJsonLd(SITE_DESCRIPTION, base)
  const byType = (type: string) => data['@graph'].find((node) => node['@type'] === type) as Record<string, unknown>

  it('describes the extension as a browser application with its current image and store listings', () => {
    const app = byType('SoftwareApplication')
    expect(app).toMatchObject({
      name: 'TabMerger',
      applicationCategory: 'BrowserApplication',
      operatingSystem: 'Chrome, Brave, Edge, Firefox',
      url: 'https://example.test/',
      image: 'https://example.test/opengraph-image.png',
      screenshot: 'https://example.test/opengraph-image.png',
      installUrl: STORE_LISTING_URL.CHROME_STABLE,
    })
    expect(app.sameAs).toEqual([
      STORE_LISTING_URL.CHROME_STABLE,
      STORE_LISTING_URL.FIREFOX_STABLE,
      STORE_LISTING_URL.EDGE_STABLE,
      GITHUB_REPO_URL,
    ])
  })

  type Offer = { name: string; price: string; priceCurrency: string; priceSpecification?: Record<string, unknown>[] }
  const AI_OFF = { managed: false, byok: false, any: false }
  const BYOK_ONLY = { managed: false, byok: true, any: true }
  const ALL_ON = { managed: true, byok: true, any: true }
  const offersOf = (ai: typeof AI_OFF) =>
    (homeJsonLd(SITE_DESCRIPTION, base, ai)['@graph'].find((node) => node['@type'] === 'SoftwareApplication') as { offers: Offer[] }).offers

  it('offers Free and Pro at the PRICING_TIERS prices, and no Pro AI while no AI option is on sale', () => {
    const offers = offersOf(AI_OFF)
    expect(offers.map((o) => o.name)).toEqual(['Free', 'Pro'])
    const free = getPricingTier('free')
    const pro = getPricingTier('pro')
    expect(offers[0]).toEqual({ '@type': 'Offer', name: free.name, price: String(free.monthlyPrice), priceCurrency: 'USD' })
    expect(offers[0].price).toBe('0')
    expect(offers[1]).toMatchObject({ name: pro.name, price: String(pro.monthlyPrice), priceCurrency: 'USD' })
    expect(offers[1].priceSpecification).toEqual([
      expect.objectContaining({ price: String(pro.monthlyPrice), priceCurrency: 'USD', billingDuration: 'P1M' }),
      expect.objectContaining({ price: String(pro.yearlyPrice), priceCurrency: 'USD', billingDuration: 'P1Y' }),
    ])
  })

  it('adds both Pro AI options at their PRICING_TIERS prices when all AI is on sale', () => {
    const offers = offersOf(ALL_ON)
    expect(offers.map((o) => o.name)).toEqual([...PRICING_TIERS.map((t) => t.name), PRO_AI_BYOK_OFFER_NAME])
    const proAi = getPricingTier('pro_ai')
    expect(offers[2]).toMatchObject({ name: proAi.name, price: String(proAi.monthlyPrice) })
    expect(offers[2].priceSpecification?.map((spec) => spec.price)).toEqual([String(proAi.monthlyPrice), String(proAi.yearlyPrice)])
    expect(offers[3]).toMatchObject({ name: PRO_AI_BYOK_OFFER_NAME, price: String(proAi.byok!.monthlyPrice) })
    expect(offers[3].priceSpecification?.map((spec) => spec.price)).toEqual([String(proAi.byok!.monthlyPrice), String(proAi.byok!.yearlyPrice)])
  })

  it('offers only the own-provider Pro AI when only that option is on sale', () => {
    expect(offersOf(BYOK_ONLY).map((o) => o.name)).toEqual(['Free', 'Pro', PRO_AI_BYOK_OFFER_NAME])
  })

  it('defaults to the build-time AI flags', () => {
    expect((byType('SoftwareApplication') as { offers: Offer[] }).offers).toEqual(offersOf(AI_AVAILABILITY))
  })

  it('states no rating: the store ratings are streamed in after the page, not known up front', () => {
    expect(JSON.stringify(data)).not.toMatch(/aggregateRating/)
  })

  it('includes the website and its publisher, linked by @id', () => {
    expect(byType('WebSite')).toMatchObject({ url: 'https://example.test/', publisher: { '@id': 'https://example.test/#organization' } })
    expect(byType('Organization')).toMatchObject({ '@id': 'https://example.test/#organization', url: 'https://example.test/' })
  })

  it('serialises with every < escaped, so no value can close the script element', () => {
    const json = serializeJsonLd({ name: '</script><script>alert(1)</script>' })
    expect(json).not.toContain('<')
    expect(json).toContain('\\u003c/script>')
    expect(JSON.parse(json)).toEqual({ name: '</script><script>alert(1)</script>' })
  })

  it('JsonLd renders one ld+json script holding the escaped JSON', () => {
    const { container } = render(<JsonLd data={{ a: '<b>' }} />)
    const scripts = container.querySelectorAll('script[type="application/ld+json"]')
    expect(scripts).toHaveLength(1)
    expect(scripts[0].innerHTML).toBe('{"a":"\\u003cb>"}')
  })
})

describe('FAQ JSON-LD', () => {
  const t = createTranslator({ locale: 'en', messages: en, namespace: 'faq' })
  const AI_OFF = { managed: false, byok: false, any: false }

  it('lists every FAQ question in display order, word for word from the en catalog', () => {
    const data = faqJsonLd(faqItems(t, AI_OFF))
    expect(data['@type']).toBe('FAQPage')
    expect(data.mainEntity.map((q) => q.name)).toEqual(FAQ_KEYS.map((key) => en.faq[key].question))
    for (const q of data.mainEntity) {
      expect(q['@type']).toBe('Question')
      expect(q.acceptedAnswer['@type']).toBe('Answer')
      expect(q.acceptedAnswer.text.length).toBeGreaterThan(0)
    }
  })

  it('fills the free-plan answer from FREE_TIER_LIMITS, with no ICU placeholder left', () => {
    const free = faqItems(t, AI_OFF).find((item) => item.key === 'free')!
    expect(free.answer).toContain(String(FREE_TIER_LIMITS.groups))
    expect(free.answer).toContain(String(FREE_TIER_LIMITS.tabs))
    expect(free.answer).not.toMatch(/[{}]/)
  })

  it('gives the AI answer for what is actually on sale', () => {
    const aiAnswer = (ai: typeof AI_OFF) => faqItems(t, ai).find((item) => item.key === 'ai')!.answer
    expect(aiAnswer(AI_OFF)).toBe(en.faq.ai.answerComingSoon)
    expect(aiAnswer({ managed: false, byok: true, any: true })).toBe(en.faq.ai.answerOwnKey)
    expect(aiAnswer({ managed: true, byok: true, any: true })).toBe(en.faq.ai.answer)
  })
})

describe('preview noindex header', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function headersFor(vercelEnv: string) {
    vi.stubEnv('VERCEL_ENV', vercelEnv)
    const { previewNoindexHeaders } = await import('../next.config')
    return previewNoindexHeaders()
  }

  it('sends X-Robots-Tag: noindex on every path of a Vercel preview deployment', async () => {
    expect(await headersFor('preview')).toEqual([
      { source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] },
    ])
  })

  it.each([
    ['production', 'production'],
    ['local development and CI next start (no VERCEL_ENV)', ''],
    ['a Vercel development deployment', 'development'],
  ])('sends nothing on %s', async (_label, vercelEnv) => {
    expect(await headersFor(vercelEnv)).toEqual([])
  })

  it('is part of next.config headers() on preview only', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const config = (await import('../next.config')).default as { headers: () => Promise<{ source: string }[]> }
    expect((await config.headers()).map((rule) => rule.source)).toContain('/:path*')
    vi.stubEnv('VERCEL_ENV', '')
    expect((await config.headers()).map((rule) => rule.source)).not.toContain('/:path*')
  })

  it('isPreviewDeployment ignores NEXT_PUBLIC_VERCEL_ENV and an unset VERCEL_ENV', () => {
    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    expect(isPreviewDeployment()).toBe(false)
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(isPreviewDeployment()).toBe(true)
  })
})
