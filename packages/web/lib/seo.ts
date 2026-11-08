import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { PRICING_TIERS, STORE_LISTING_URL, type AiAvailability, type PricingTier } from '@tabmerger/shared'
import { AI_AVAILABILITY } from '@/lib/aiFlag'
import type { FaqItem } from '@/lib/faq'
import { DEFAULT_LOCALE, OG_LOCALES, isAppLocale, languageAlternates, localizedPath, type AppLocale } from '@/i18n/locales'
import { GITHUB_REPO_URL } from '@/lib/github'
import { getMetadataBase } from '@/lib/utils'

/**
 * One place for the site's search and social-preview metadata.
 *
 * Why every page goes through `pageMetadata()`: Next merges a page's metadata into its layouts'
 * shallowly. A page that sets `openGraph` or `twitter` replaces the root layout's object whole
 * (its title, description, type, site name AND the file-convention image), and a page that
 * doesn't set them shares as the root layout, so every page previewed as the homepage. The
 * helper builds the full objects from a page's own title, description and path.
 */

export const SITE_NAME = 'TabMerger'

/** Child page titles render as "<page> | TabMerger". */
export const TITLE_TEMPLATE = `%s | ${SITE_NAME}`

/**
 * `app/opengraph-image.png` and `app/twitter-image.png` (the same 1280×640 picture). Next adds
 * them only to pages that set no `openGraph`/`twitter` of their own, so the helper names them
 * explicitly. The English alt text (`metadata.socialImageAlt`) matches the `.alt.txt` files next
 * to them (a test checks).
 */
const SOCIAL_IMAGE = { width: 1280, height: 640 }

/** For pages search engines should never list (sign-in, share links, the signed-in app). */
export const NOINDEX: Metadata['robots'] = { index: false }

interface PageMetadataInput {
  /** The page's path ("/" for the homepage), without a locale prefix. Resolved against `metadataBase` by Next. */
  path: string
  /** The page's own title, without the brand: the template adds " | TabMerger". */
  title: string
  description: string
  /** Use `title` as the whole document title, skipping the template (the homepage). */
  absoluteTitle?: boolean
  /**
   * English-only pages (Privacy, Terms: the binding text is not translated). Every locale's copy
   * points its canonical at the English URL and only English is listed as an alternate.
   */
  englishOnly?: boolean
  /** Defaults to the request's locale. */
  locale?: AppLocale
}

/** The request's locale, narrowed (a non-locale value can't reach here, but never trust it). */
async function currentLocale(): Promise<AppLocale> {
  const locale = await getLocale()
  return isAppLocale(locale) ? locale : DEFAULT_LOCALE
}

/**
 * A page's `Metadata`: title, description, canonical URL, hreflang alternates, and Open Graph +
 * Twitter cards that carry the same title, description and URL as the page itself.
 *
 * The canonical is relative, so it resolves against `metadataBase` (`getMetadataBase()`), which is
 * the deployment's own origin. On the preview deployment that is the preview host, which is fine
 * because the preview deployment (`isPreviewDeployment()`) answers `X-Robots-Tag: noindex`
 * (`previewNoindexHeaders()` in next.config.ts). Local development, CI and production send no such
 * header.
 *
 * Alternates list the public locales only (`en` today) plus `x-default`.
 */
export async function pageMetadata({
  path,
  title,
  description,
  absoluteTitle = false,
  englishOnly = false,
  locale: requested,
}: PageMetadataInput): Promise<Metadata> {
  const locale = requested ?? (await currentLocale())
  const t = await getTranslations({ locale, namespace: 'metadata' })
  const url = englishOnly ? path : localizedPath(locale, path)
  const fullTitle = absoluteTitle ? title : TITLE_TEMPLATE.replace('%s', title)
  const alt = t('socialImageAlt')
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: {
      canonical: url,
      languages: englishOnly ? { [DEFAULT_LOCALE]: path, 'x-default': path } : languageAlternates(path),
    },
    openGraph: {
      type: 'website',
      locale: OG_LOCALES[locale],
      siteName: SITE_NAME,
      url,
      title: fullTitle,
      description,
      images: [{ url: '/opengraph-image.png', ...SOCIAL_IMAGE, alt }],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [{ url: '/twitter-image.png', ...SOCIAL_IMAGE, alt }],
    },
  }
}

/**
 * Site-wide defaults for a locale: the title template, and the cards for pages that set none of
 * their own (the signed-in app, auth, 404). Indexable pages set theirs through `pageMetadata()`:
 * Next replaces these objects whole, it does not merge them. No `url` here: one URL for every page
 * is what made all pages share as the homepage.
 */
export async function siteMetadata(locale: AppLocale): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'metadata' })
  const homeTitle = t('homeTitle')
  const description = t('siteDescription')
  return {
    title: { default: homeTitle, template: TITLE_TEMPLATE },
    description,
    keywords: t('keywords').split(',').map((k) => k.trim()),
    openGraph: {
      type: 'website',
      locale: OG_LOCALES[locale],
      siteName: SITE_NAME,
      title: homeTitle,
      description,
    },
    twitter: {
      card: 'summary_large_image',
      title: homeTitle,
      description,
    },
  }
}

/** Every price is US dollars (the Stripe Prices are USD-only). */
const PRICE_CURRENCY = 'USD'

/** A plan's price for one billing period, as schema.org states a recurring charge. */
function unitPrice(price: number, period: 'month' | 'year') {
  return {
    '@type': 'UnitPriceSpecification',
    price: String(price),
    priceCurrency: PRICE_CURRENCY,
    billingDuration: period === 'month' ? 'P1M' : 'P1Y',
    referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: period === 'month' ? 'MON' : 'ANN' },
  }
}

/** Name of the Pro AI option where the customer brings their own AI provider (`tier.byok`). */
export const PRO_AI_BYOK_OFFER_NAME = 'Pro AI (your own AI provider)'

/** One Offer at a plan's monthly price, with its monthly and yearly charges spelled out when paid. */
function offer(name: string, monthlyPrice: number, yearlyPrice: number) {
  return {
    '@type': 'Offer',
    name,
    price: String(monthlyPrice),
    priceCurrency: PRICE_CURRENCY,
    ...(monthlyPrice > 0 ? { priceSpecification: [unitPrice(monthlyPrice, 'month'), unitPrice(yearlyPrice, 'year')] } : {}),
  }
}

/**
 * One Offer per plan someone can buy today, matching what the pricing page sells. Free and Pro
 * always. Pro AI on TabMerger's AI while managed AI is on sale (`NEXT_PUBLIC_AI_ENABLED`), and Pro
 * AI on the customer's own AI provider while that option is (`NEXT_PUBLIC_AI_BYOK_ENABLED`, also on
 * with managed). With neither on, the site shows Pro AI as "Coming soon", so it is not offered.
 * Every price comes from `PRICING_TIERS`.
 */
function planOffers(ai: AiAvailability) {
  return PRICING_TIERS.flatMap((tier: PricingTier) => {
    if (tier.id !== 'pro_ai') return [offer(tier.name, tier.monthlyPrice, tier.yearlyPrice)]
    return [
      ...(ai.managed ? [offer(tier.name, tier.monthlyPrice, tier.yearlyPrice)] : []),
      ...(ai.byok && tier.byok ? [offer(PRO_AI_BYOK_OFFER_NAME, tier.byok.monthlyPrice, tier.byok.yearlyPrice)] : []),
    ]
  })
}

/**
 * The homepage's structured data: the website, its publisher, and the extension itself.
 *
 * The extension node names its current picture twice: `image` and `screenshot` are the Open Graph
 * image (the popup as it looks now), so a product card has no reason to reach for an older one.
 * `installUrl` and `sameAs` point at the stable store listings (plus the source), which identify
 * the extension unambiguously. `operatingSystem` matches the browsers the Open Graph image lists:
 * the Chrome Web Store build also installs on Brave.
 *
 * No `aggregateRating`: the store ratings the landing page shows are fetched from three stores
 * and streamed in after the page (a Suspense boundary). Putting them here would make the whole
 * page wait on those requests, and a rating in structured data must match one visible on the
 * page, which a cached build-time figure would not reliably do.
 */
export function homeJsonLd(description: string, base: URL = getMetadataBase(), ai: AiAvailability = AI_AVAILABILITY) {
  const origin = base.origin
  const organizationId = `${origin}/#organization`
  const storeListings = [STORE_LISTING_URL.CHROME_STABLE, STORE_LISTING_URL.FIREFOX_STABLE, STORE_LISTING_URL.EDGE_STABLE]
  const currentImage = `${origin}/opengraph-image.png`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: SITE_NAME,
        url: `${origin}/`,
        logo: `${origin}/icon.png`,
        sameAs: [GITHUB_REPO_URL, ...storeListings],
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        name: SITE_NAME,
        url: `${origin}/`,
        description,
        publisher: { '@id': organizationId },
      },
      {
        '@type': 'SoftwareApplication',
        name: SITE_NAME,
        description,
        url: `${origin}/`,
        image: currentImage,
        screenshot: currentImage,
        applicationCategory: 'BrowserApplication',
        operatingSystem: 'Chrome, Brave, Edge, Firefox',
        installUrl: STORE_LISTING_URL.CHROME_STABLE,
        sameAs: [...storeListings, GITHUB_REPO_URL],
        offers: planOffers(ai),
        publisher: { '@id': organizationId },
      },
    ],
  }
}

/**
 * The /faq page's FAQPage structured data. Built from the same items the page renders
 * (`faqItems()` in `lib/faq.ts`), so every question and answer here is word for word the visible
 * text, which structured data must be.
 */
export function faqJsonLd(items: ReadonlyArray<Pick<FaqItem, 'question' | 'answer'>>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  }
}

/**
 * JSON for an inline `<script type="application/ld+json">`. `JSON.stringify` leaves `<` as is,
 * so a value containing `</script>` would end the script element early and whatever followed
 * would be parsed as HTML. `<` is the same character to a JSON parser and inert to HTML.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
