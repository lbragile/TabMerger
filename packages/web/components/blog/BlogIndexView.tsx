import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { getMessages, getTranslations } from 'next-intl/server'
import { FeaturedPost, Pager, PostRow, PostRows, TopicChips, TopicSuggestions } from '@/components/blog/BlogListing'
import { HelpfulCountsProvider, type ListingMessages } from '@/components/blog/HelpfulCounts'
import { ListingClient } from '@/components/blog/ListingClient'
import { JsonLd } from '@/components/seo/JsonLd'
import { DEFAULT_LOCALE, localizedPath } from '@/i18n/locales'
import { blogIndexJsonLd } from '@/lib/blog/jsonLd'
import { blogIndexPagePath, blogPageSize, blogTagPagePath, pageCount, pageItems, parsePageParam } from '@/lib/blog/paging'
import { BLOG_PATH, blogPostPath, isPublished, listedTagCounts, loadAllPosts, tagPostCount, topTags, type LoadedPost } from '@/lib/blog/posts'
import { byRelevance, type TagEntry } from '@/lib/blog/tagOrder'
import { BLOG_TAGS, TAG_INDEX_MIN_POSTS, type BlogTag } from '@/lib/blog/tags'
import { breadcrumbJsonLd, pageMetadata, SITE_NAME } from '@/lib/seo'

/**
 * The blog index (`/blog`, `/blog/page/<n>`) and tag pages (`/blog/tags/<tag>`,
 * `/blog/tags/<tag>/page/<n>`): one renderer and one metadata builder for both, so the two
 * paginate alike. Like the posts, they are English-only for now (canonical on the English URL).
 */

/**
 * The posts a listing shows, newest first: all of them, or those carrying `tag`. Live posts, plus
 * scheduled ones (flagged on their cards) under `next dev` only (`loadAllPosts`). The noindex rule
 * below still counts live posts only (`tagPostCount`).
 */
async function listingPosts(locale: string, tag?: BlogTag): Promise<LoadedPost[]> {
  const posts = await loadAllPosts(locale)
  return tag ? posts.filter(({ post }) => post.tags.includes(tag)) : posts
}

/**
 * The index's order: the newest LIVE post first (page 1 features it), then every other post newest
 * first. Only `next dev` lists scheduled posts, and they are never featured: they keep their order
 * at the top of the list, flagged. Without a live post nothing moves (and nothing is featured).
 */
export function indexOrder(posts: readonly LoadedPost[], now: Date = new Date()): LoadedPost[] {
  const latest = posts.findIndex(({ post }) => isPublished(post, now))
  return latest <= 0 ? [...posts] : [posts[latest], ...posts.slice(0, latest), ...posts.slice(latest + 1)]
}

/**
 * Every tag in use with its label in the request's language and its post count, by relevance
 * (most posts first, then alphabetically): the topic chips' order and the all-topics page's list.
 */
export async function relevantTags(locale: string): Promise<TagEntry[]> {
  const t = await getTranslations('blog')
  return byRelevance(
    [...listedTagCounts().entries()].map(([tag, count]) => ({ tag, count, label: t(`tags.${BLOG_TAGS[tag]}`) })),
    locale
  )
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

/** The `blog` messages the client listing formats itself (sort, search, counts, pager). */
const LISTING_MESSAGE_KEYS = [
  'sortLabel',
  'sortNewest',
  'sortOldest',
  'sortHelpful',
  'sortShortest',
  'searchLabel',
  'searchPlaceholder',
  'sortButton',
  'resultsMatch',
  'searchingAll',
  'noResults',
  'emptyHint',
  'clearSearch',
  'helpfulCount',
  'moreGuides',
  'pagerLabel',
  'newer',
  'older',
  'pageOf',
  'pageNumber',
] as const

/** Those messages in the request's language, as raw ICU strings for the browser. */
async function listingMessages(): Promise<ListingMessages> {
  const blog = ((await getMessages()) as { blog?: Record<string, unknown> }).blog ?? {}
  return Object.fromEntries(LISTING_MESSAGE_KEYS.map((key) => [key, String(blog[key] ?? key)]))
}

/** A listing page: header (H1, lead, topic chips), then featured (index page 1), list and pager. */
export async function BlogIndexView({ locale, page, tag }: { locale: string; page: number; tag?: BlogTag }) {
  const t = await getTranslations('blog')
  const nav = await getTranslations('nav')
  const listed = await listingPosts(locale, tag)
  // Tag pages have no featured panel, so they keep plain newest-first order.
  const posts = tag ? listed : indexOrder(listed)
  const size = blogPageSize()
  const total = pageCount(posts.length, size)
  const shown = pageItems(posts, page, size)
  const label = tag ? t(`tags.${BLOG_TAGS[tag]}`) : ''
  const path = tag ? blogTagPagePath(tag, page) : blogIndexPagePath(page)
  const name = tag ? t('tagTitle', { tag: label }) : t('metaTitle')
  // The featured panel is the newest live post (first in `indexOrder`); a scheduled one (dev only)
  // is never featured, so with no live post there is no panel.
  const hasFeatured = !tag && posts.length > 0 && isPublished(posts[0].post)
  const featured = hasFeatured && page === 1
  const hrefFor = (n: number) => (tag ? blogTagPagePath(tag, n) : blogIndexPagePath(n))
  const rest = featured ? shown.slice(1) : shown

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
          {tag ? t('tagTitle', { tag: label }) : t('indexHeading')}
        </h1>
        <p className="m-0 leading-relaxed text-text2 sm:text-lg">
          {tag ? t('tagCount', { count: posts.length }) : t('indexLead')}
        </p>
      </header>
      <TopicChips tags={(await relevantTags(locale)).map((entry) => entry.tag)} current={tag} />
      <HelpfulCountsProvider locale={locale} messages={await listingMessages()}>
        <ListingClient
          entries={posts.map(({ post, readMinutes }) => ({ slug: post.slug, title: post.title, published: post.published, readMinutes }))}
          rows={Object.fromEntries(posts.map((loaded) => [loaded.post.slug, <PostRow key={loaded.post.slug} loaded={loaded} />]))}
          featured={featured ? <FeaturedPost loaded={shown[0]} /> : null}
          defaultList={rest.length > 0 ? <PostRows posts={rest} /> : null}
          defaultPager={<Pager page={page} total={total} hrefFor={hrefFor} />}
          moreCount={hasFeatured ? posts.length - 1 : posts.length}
          emptyTopics={<TopicSuggestions tags={topTags(4).filter((topic) => topic !== tag).slice(0, 3)} />}
          basePath={tag ? blogTagPagePath(tag, 1) : BLOG_PATH}
          pageSize={size}
          locale={locale}
        />
      </HelpfulCountsProvider>
    </div>
  )
}
