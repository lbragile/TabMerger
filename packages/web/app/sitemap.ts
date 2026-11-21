import type { MetadataRoute } from 'next'
import { getMetadataBase } from '@/lib/utils'
import { DEFAULT_LOCALE, PUBLIC_LOCALES, localizedPath } from '@/i18n/locales'
import { BLOG_PATH, blogPostPath, indexableSlugs, postLocales, postSummary, tagPostCount } from '@/lib/blog/posts'
import { BLOG_TAG_SLUGS, TAG_INDEX_MIN_POSTS } from '@/lib/blog/tags'
import { POSTS_PER_PAGE, blogIndexPagePath, blogTagPagePath, laterPages } from '@/lib/blog/paging'

// ponytail: static list of marketing pages — no CMS/DB-backed routes to
// enumerate dynamically. Dashboard/account/auth/api/share routes are excluded
// since they're private, dynamic, or noindex. The beta tester guide (/beta)
// is left out on purpose: it is not served on the production deployment (see lib/deployment.ts).
//
// No `lastModified`: there is no reliable per-page date, and stamping every URL with the build
// time teaches search engines to ignore the field. Leaving it out is better than a wrong date.
// Rebuilt hourly, so a post scheduled for a later date (`post.published`) shows up within an hour
// of going live without a deployment.
export const revalidate = 3600

export const SITEMAP_PATHS = ['/', '/features', '/pricing', '/compare', '/faq', '/changelog', '/privacy', '/terms', '/contact', BLOG_PATH]

/**
 * Pages that exist in English only, under every locale: the binding legal text, and the blog
 * index while every post is English-only.
 */
export const ENGLISH_ONLY_PATHS: ReadonlySet<string> = new Set(['/privacy', '/terms', BLOG_PATH])

/**
 * One entry per page and public locale, each listing every language version of its page
 * (hreflang), then one entry per blog post and locale that has its own file (a locale without
 * one is served the English file with an English canonical, so it isn't listed). A post's entries
 * list its captures (image sitemap). Only live posts (`publishedSlugs`). Tag pages follow once they have `TAG_INDEX_MIN_POSTS` posts.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getMetadataBase()
  const href = (locale: string, path: string) => new URL(localizedPath(locale, path), base).href
  const pages = SITEMAP_PATHS.flatMap((path) => {
    const locales = ENGLISH_ONLY_PATHS.has(path) ? [DEFAULT_LOCALE] : PUBLIC_LOCALES
    const languages = Object.fromEntries(locales.map((locale) => [locale, href(locale, path)]))
    return locales.map((locale) => ({
      url: href(locale, path),
      changeFrequency: path === '/' ? ('weekly' as const) : ('monthly' as const),
      priority: path === '/' ? 1 : 0.7,
      alternates: { languages },
    }))
  })
  const posts = indexableSlugs().flatMap((slug) => {
    const path = blogPostPath(slug)
    const locales = postLocales(slug)
    const languages = Object.fromEntries(locales.map((locale) => [locale, href(locale, path)]))
    return locales.map((locale) => ({
      url: href(locale, path),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
      alternates: { languages },
      images: (postSummary(slug, locale)?.images ?? []).map((src) => new URL(src, base).href),
    }))
  })
  // Tag pages only once they are indexable (enough posts); thinner ones are noindex.
  const englishOnly = (path: string, priority: number) => ({
    url: href(DEFAULT_LOCALE, path),
    changeFrequency: 'weekly' as const,
    priority,
    alternates: { languages: { [DEFAULT_LOCALE]: href(DEFAULT_LOCALE, path) } },
  })
  // Later pages of the blog index (page 1 is /blog, above), at the production page size.
  const blogPages = laterPages(indexableSlugs().length, POSTS_PER_PAGE).map((n) => englishOnly(blogIndexPagePath(n), 0.5))
  // Tag pages, every page of them, only once they are indexable (enough posts); thinner ones are noindex.
  const tags = BLOG_TAG_SLUGS.filter((tag) => tagPostCount(tag) >= TAG_INDEX_MIN_POSTS).flatMap((tag) =>
    [1, ...laterPages(tagPostCount(tag), POSTS_PER_PAGE)].map((n) => englishOnly(blogTagPagePath(tag, n), 0.4))
  )
  return [...pages, ...blogPages, ...posts, ...tags]
}
