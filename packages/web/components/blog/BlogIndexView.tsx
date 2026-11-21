import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { BlogListing, TopicChips } from '@/components/blog/BlogListing'
import { JsonLd } from '@/components/seo/JsonLd'
import { DEFAULT_LOCALE, localizedPath } from '@/i18n/locales'
import { blogIndexJsonLd } from '@/lib/blog/jsonLd'
import { blogIndexPagePath, blogPageSize, blogTagPagePath, pageCount, pageItems, parsePageParam } from '@/lib/blog/paging'
import { BLOG_PATH, blogPostPath, loadAllPosts, tagPostCount, topTags, type LoadedPost } from '@/lib/blog/posts'
import { BLOG_TAGS, TAG_INDEX_MIN_POSTS, type BlogTag } from '@/lib/blog/tags'
import { breadcrumbJsonLd, pageMetadata, SITE_NAME } from '@/lib/seo'

/**
 * The blog index (`/blog`, `/blog/page/<n>`) and tag pages (`/blog/tags/<tag>`,
 * `/blog/tags/<tag>/page/<n>`): one renderer and one metadata builder for both, so the two
 * paginate alike. Like the posts, they are English-only for now (canonical on the English URL).
 */

/** The live posts a listing shows, newest first: all of them, or those carrying `tag`. */
async function listingPosts(locale: string, tag?: BlogTag): Promise<LoadedPost[]> {
  const posts = await loadAllPosts(locale)
  return tag ? posts.filter(({ post }) => post.tags.includes(tag)) : posts
}

/**
 * The page number a `[n]` segment asks for, after the checks: `/…/page/1` is a 308 to the first
 * page's own URL, and anything that isn't a page of this listing is a 404.
 */
export async function resolveListingPage(raw: string, locale: string, tag?: BlogTag): Promise<number> {
  const page = parsePageParam(raw)
  if (page === null) notFound()
  if (page === 1) permanentRedirect(localizedPath(locale, tag ? blogTagPagePath(tag, 1) : BLOG_PATH))
  const total = pageCount((await listingPosts(locale, tag)).length, blogPageSize())
  if (page > total) notFound()
  return page
}

/** A listing page's metadata: self-canonical, "<title>, page N" after the first page. */
export async function listingMetadata(page: number, tag?: BlogTag): Promise<Metadata> {
  const t = await getTranslations('blog')
  const label = tag ? t(`tags.${BLOG_TAGS[tag]}`) : ''
  const base = tag ? t('tagTitle', { tag: label }) : t('metaTitle')
  const title = page > 1 ? t('pagedTitle', { title: tag ? base : t('indexTitle'), page }) : base
  const description = tag ? t('tagDescription', { tag: label }) : t('metaDescription')
  const metadata = await pageMetadata({
    path: tag ? blogTagPagePath(tag, page) : blogIndexPagePath(page),
    title,
    description,
    englishOnly: true,
  })
  return tag && tagPostCount(tag) < TAG_INDEX_MIN_POSTS ? { ...metadata, robots: { index: false, follow: true } } : metadata
}

/** A listing page: header (H1, lead, topic chips), then featured (index page 1), list and pager. */
export async function BlogIndexView({ locale, page, tag }: { locale: string; page: number; tag?: BlogTag }) {
  const t = await getTranslations('blog')
  const nav = await getTranslations('nav')
  const posts = await listingPosts(locale, tag)
  const size = blogPageSize()
  const total = pageCount(posts.length, size)
  const shown = pageItems(posts, page, size)
  const label = tag ? t(`tags.${BLOG_TAGS[tag]}`) : ''
  const path = tag ? blogTagPagePath(tag, page) : blogIndexPagePath(page)
  const name = tag ? t('tagTitle', { tag: label }) : t('metaTitle')

  return (
    <div className="container max-w-[70rem] pb-20 pt-10 sm:pt-16">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: SITE_NAME, path: '/' },
          { name: nav('blog'), path: BLOG_PATH },
          ...(tag ? [{ name: `#${label}`, path: blogTagPagePath(tag, 1) }] : []),
          ...(page > 1 ? [{ name: t('pageNumber', { page }), path }] : []),
        ])}
      />
      <JsonLd
        data={blogIndexJsonLd(
          shown.map(({ post, contentLocale }) => ({
            post,
            path: localizedPath(contentLocale === locale ? locale : DEFAULT_LOCALE, blogPostPath(post.slug)),
          })),
          path,
          page > 1 ? t('pagedTitle', { title: tag ? name : t('indexTitle'), page }) : name
        )}
      />
      <header className="flex max-w-[44rem] flex-col gap-2.5 sm:gap-3">
        <h1 className="m-0 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
          {tag ? t('tagTitle', { tag: label }) : t('indexTitle')}
        </h1>
        <p className="m-0 leading-relaxed text-text2 sm:text-lg">
          {tag ? t('tagCount', { count: posts.length }) : t('indexLead')}
        </p>
      </header>
      <TopicChips tags={topTags(5)} current={tag} />
      <BlogListing
        posts={shown}
        page={page}
        total={total}
        featured={!tag && page === 1}
        hrefFor={(n) => (tag ? blogTagPagePath(tag, n) : blogIndexPagePath(n))}
      />
    </div>
  )
}
