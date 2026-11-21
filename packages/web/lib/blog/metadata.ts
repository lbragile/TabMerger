import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { DEFAULT_LOCALE, isAppLocale, localizedPath } from '@/i18n/locales'
import { BLOG_AUTHOR, blogPostPath, type LoadedPost } from '@/lib/blog/posts'

/**
 * A post page's metadata: `pageMetadata()` (title, description, canonical, cards) with the
 * blog's rules on top.
 *
 * - A locale with its own file is a real translation: canonical on its own URL, hreflang listing
 *   only the locales that have a file (plus `x-default`, the English URL).
 * - A locale without one shows the English file: canonical on the English URL and only English
 *   as an alternate (`englishOnly`, like /privacy).
 * - Open Graph is an `article` with its dates, author, tags (`article:tag`, the labels in the
 *   shown file's language) and the post's own preview image.
 */
export async function blogPostMetadata(loaded: LoadedPost, locale: string, tagLabels: readonly string[] = []): Promise<Metadata> {
  const { post, contentLocale, locales } = loaded
  const path = blogPostPath(post.slug)
  // The page shows its own locale's file (English on /blog/..., or a translation).
  const ownFile = contentLocale === locale
  const base = await pageMetadata({
    path,
    title: post.seoTitle,
    description: post.description,
    englishOnly: !ownFile,
    locale: isAppLocale(locale) ? locale : DEFAULT_LOCALE,
  })
  const languages = ownFile
    ? { ...Object.fromEntries(locales.map((l) => [l, localizedPath(l, path)])), 'x-default': path }
    : base.alternates?.languages
  // The designed card (scripts/blog-screenshots/og.mjs), PNG for LinkedIn (no WebP). Next makes
  // the URL absolute against metadataBase.
  const image = post.ogImage
    ? { url: post.ogImage.src, width: 1200, height: 630, type: 'image/png', alt: post.ogImage.alt }
    : undefined
  return {
    ...base,
    alternates: { ...base.alternates, languages },
    authors: [{ name: BLOG_AUTHOR.name, url: BLOG_AUTHOR.url }],
    openGraph: {
      ...base.openGraph,
      type: 'article',
      publishedTime: post.published,
      modifiedTime: post.updated,
      authors: [BLOG_AUTHOR.url],
      ...(tagLabels.length > 0 ? { tags: [...tagLabels] } : {}),
      ...(image ? { images: [image] } : {}),
    },
    twitter: { ...base.twitter, ...(image ? { images: [image] } : {}) },
  }
}
