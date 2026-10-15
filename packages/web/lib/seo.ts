import type { Metadata } from 'next'
import { PRICING_TIERS, STORE_LISTING_URL } from '@tabmerger/shared'
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

/** The homepage's title, and the title of pages that set none. */
export const HOME_TITLE = `${SITE_NAME} — Organize your tabs. Reclaim your focus.`

export const SITE_DESCRIPTION =
  'TabMerger groups your open tabs into a clean, searchable panel — saving memory and mental bandwidth.'

/**
 * `app/opengraph-image.png` and `app/twitter-image.png` (the same 1280×640 picture). Next adds
 * them only to pages that set no `openGraph`/`twitter` of their own, so the helper names them
 * explicitly. The alt text matches the `.alt.txt` files next to them (a test checks).
 */
export const SOCIAL_IMAGE_ALT = 'TabMerger: Tab chaos in. Order out. The TabMerger popup with tabs saved into groups.'
const OG_IMAGE = { url: '/opengraph-image.png', width: 1280, height: 640, alt: SOCIAL_IMAGE_ALT }
const TWITTER_IMAGE = { url: '/twitter-image.png', width: 1280, height: 640, alt: SOCIAL_IMAGE_ALT }

/** For pages search engines should never list (sign-in, share links, the signed-in app). */
export const NOINDEX: Metadata['robots'] = { index: false }

interface PageMetadataInput {
  /** The page's path ("/" for the homepage). Resolved against `metadataBase` by Next. */
  path: string
  /** The page's own title, without the brand: the template adds " | TabMerger". */
  title: string
  description: string
  /** Use `title` as the whole document title, skipping the template (the homepage). */
  absoluteTitle?: boolean
}

/**
 * A page's `Metadata`: title, description, canonical URL, and Open Graph + Twitter cards that
 * carry the same title, description and URL as the page itself.
 *
 * The canonical is relative, so it resolves against `metadataBase` (`getMetadataBase()`), which is
 * the deployment's own origin. On the preview deployment that is the preview host, which is fine
 * because a Vercel preview deployment (`VERCEL_ENV === 'preview'`) answers `X-Robots-Tag: noindex`
 * (`previewNoindexHeaders()` in next.config.ts). Local development, CI and production send no such
 * header.
 */
export function pageMetadata({ path, title, description, absoluteTitle = false }: PageMetadataInput): Metadata {
  const fullTitle = absoluteTitle ? title : TITLE_TEMPLATE.replace('%s', title)
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      locale: 'en_US',
      siteName: SITE_NAME,
      url: path,
      title: fullTitle,
      description,
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [TWITTER_IMAGE],
    },
  }
}

/**
 * The homepage's structured data: the website, its publisher, and the extension itself.
 *
 * No `aggregateRating`: the store ratings the landing page shows are fetched from three stores
 * and streamed in after the page (a Suspense boundary). Putting them here would make the whole
 * page wait on those requests, and a rating in structured data must match one visible on the
 * page, which a cached build-time figure would not reliably do.
 */
export function homeJsonLd(base: URL = getMetadataBase()) {
  const origin = base.origin
  const free = PRICING_TIERS.find((tier) => tier.id === 'free')
  const organizationId = `${origin}/#organization`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: SITE_NAME,
        url: `${origin}/`,
        logo: `${origin}/icon.png`,
        sameAs: [
          GITHUB_REPO_URL,
          STORE_LISTING_URL.CHROME_STABLE,
          STORE_LISTING_URL.FIREFOX_STABLE,
          STORE_LISTING_URL.EDGE_STABLE,
        ],
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        name: SITE_NAME,
        url: `${origin}/`,
        description: SITE_DESCRIPTION,
        publisher: { '@id': organizationId },
      },
      {
        '@type': 'SoftwareApplication',
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        url: `${origin}/`,
        image: `${origin}${OG_IMAGE.url}`,
        applicationCategory: 'BrowserApplication',
        operatingSystem: 'Chrome, Firefox, Edge',
        offers: {
          '@type': 'Offer',
          price: String(free?.monthlyPrice ?? 0),
          priceCurrency: 'USD',
        },
        publisher: { '@id': organizationId },
      },
    ],
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
