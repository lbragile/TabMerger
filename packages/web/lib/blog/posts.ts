import type { MDXContent } from 'mdx/types'
import { z } from 'zod'
import { BLOG_SOURCES as GENERATED_SOURCES } from '@/generated/blog'
import { DEFAULT_LOCALE, PUBLIC_LOCALES } from '@/i18n/locales'
import { readMinutes } from '@/lib/blog/readTime'
import type { CardCover } from '@/lib/blog/cover'
import { BLOG_TAG_SLUGS, POST_TAGS_MAX, POST_TAGS_MIN, type BlogTag } from '@/lib/blog/tags'

/**
 * The blog's posts: one folder per post under `content/blog/<slug>/`, one MDX file per locale
 * (`en.mdx` first). Each file exports its data as `export const post = {...}` (`@next/mdx` has no
 * frontmatter) and its body as the default export. `generated/blog.ts` lists the files
 * (scripts/generate-blog-index.mjs), so a new locale file is published without a code change.
 *
 * A locale without its own file is served the English one, like /privacy and /terms: canonical
 * on the English URL, no hreflang alternates for it, no sitemap entry.
 */

/**
 * Dev-only placeholder posts (content/blog/_placeholders) count only under `next dev`
 * (NODE_ENV "development") and not with BLOG_DEV_PLACEHOLDERS=0. The generated module lists them
 * (flagged) in every mode but a production build, so `next dev`, Vitest and `type-check` write the
 * same file; this decides whether they show.
 */
export function placeholdersEnabled(env: { NODE_ENV?: string; BLOG_DEV_PLACEHOLDERS?: string } = process.env): boolean {
  return env.NODE_ENV === 'development' && env.BLOG_DEV_PLACEHOLDERS !== '0'
}

/** The generated post list without the placeholder posts. */
export function withoutPlaceholders<T extends Record<string, Record<string, { placeholder?: boolean }>>>(sources: T): T {
  return Object.fromEntries(Object.entries(sources).filter(([, locales]) => !locales[DEFAULT_LOCALE]?.placeholder)) as T
}

/** The posts this server knows: the generated list, placeholders only when they're enabled. */
export const BLOG_SOURCES: typeof GENERATED_SOURCES = placeholdersEnabled() ? GENERATED_SOURCES : withoutPlaceholders(GENERATED_SOURCES)

/** Every post is written by the maintainer: one author, never a per-post field. */
export const BLOG_AUTHOR = { name: 'lbragile', url: 'https://github.com/lbragile' } as const

/** URL path of the blog index. Post paths are `${BLOG_PATH}/<slug>`. */
export const BLOG_PATH = '/blog'

/** A post's path without a locale prefix. */
export function blogPostPath(slug: string): string {
  return `${BLOG_PATH}/${slug}`
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
const imagePath = z.string().regex(/^\/blog\/[a-z0-9-]+\/[a-z0-9/-]+\.(webp|png|jpg)$/)
const sitePathOrHttps = z.string().refine((v) => /^\/(?!\/)/.test(v) || /^https:\/\//.test(v), 'a site path or an https URL')

const postSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,80}$/),
  /** The H1 and the BlogPosting headline. */
  title: z.string().min(1),
  /** The document title without the brand (the title template adds " | TabMerger"). */
  seoTitle: z.string().min(1),
  /** Meta description, also the blog index card's summary. */
  description: z.string().min(1),
  /** Optional shorter title for the previous/next links at the end of other posts. */
  navTitle: z.string().min(1).max(80).optional(),
  /** One line (≤100 characters) for the X and Bluesky share text. */
  shareSummary: z.string().min(1).max(100),
  /** Optional small line above a post's title (not shown on this blog's pages today). */
  kicker: z.string().min(1).optional(),
  /** The line under the H1. */
  dek: z.string().min(1),
  published: isoDate,
  updated: isoDate,
  /** The exact browser versions the steps and screenshots were checked on (shown as pills). */
  testedOn: z.array(z.string().min(1)).min(1),
  /** The rail's key facts (at most 4, so the rail fits on screen), each with its source. */
  keyFacts: z
    .array(z.object({ text: z.string().min(1), source: z.string().min(1), href: sitePathOrHttps.optional() }))
    .max(4),
  /** Rendered by `<Faq items={post.faq} />` and fed to FAQPage JSON-LD (plain text). */
  faq: z
    .array(
      z.object({
        question: z.string().min(1),
        answer: z.string().min(1),
        /** Links the first occurrence of `text` inside the visible answer. */
        link: z.object({ text: z.string().min(1), href: sitePathOrHttps }).optional(),
      })
    )
    .min(1),
  /** Every capture in the post, for the image sitemap and the BlogPosting `image`. */
  images: z
    .array(
      z.object({
        src: z.string().regex(/^\/blog\/[a-z0-9-]+\/[a-z0-9/-]+\.(webp|png|jpg)$/),
        alt: z.string().min(1),
      })
    )
    .min(1),
  /**
   * The blog index card image, shown whole in a 4:3 frame: a 4:3 capture (within 2%; the
   * generator checks) that shows what the title is about. `srcDark` is its dark-theme version
   * (found automatically for a `-light` file with a `-dark` one beside it). Decorative: the card's
   * title names it. Translations use the English cover. Without one, the first 4:3 `images` entry.
   */
  cover: z.object({ src: imagePath, srcDark: imagePath.optional(), alt: z.literal('').optional() }).strict().optional(),
  /** The social preview (1200×630), made once from one of the captures. */
  ogImage: z
    .object({ src: z.string().regex(/^\/blog\/[a-z0-9-]+\/[a-z0-9/-]+\.(webp|png|jpg)$/), alt: z.string().min(1) })
    .optional(),
  /** 3 to 8 topic tags from the vocabulary in lib/blog/tags.ts, no repeats; the first leads the share hashtags. */
  tags: z
    .array(z.enum(BLOG_TAG_SLUGS))
    .min(POST_TAGS_MIN)
    .max(POST_TAGS_MAX)
    .refine((tags) => new Set(tags).size === tags.length, 'no repeated tags'),
  /** The pages the post relies on, listed under "Sources" and as BlogPosting `citation`. */
  sources: z
    .array(
      z.object({
        title: z.string().min(1),
        publisher: z.string().min(1),
        url: z.string().regex(/^https:\/\//),
        checked: isoDate,
        note: z.string().min(1).optional(),
      })
    )
    .default([]),
  /** When the screenshots were captured (the last item under "Sources"); defaults to `published`. */
  screenshotsCaptured: isoDate.optional(),
  /** The "On this page" list: section ids in the body and their short labels. */
  toc: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), label: z.string().min(1) })).min(1),
  /** Sections whose steps switch with the browser switcher (its tabs' `aria-controls`). */
  browserSections: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
  /** The rail's per-browser line under its switcher (e.g. the startup settings URL). */
  browserFact: z
    .object({
      label: z.string().min(1),
      values: z.object({ chrome: z.string().min(1), firefox: z.string().min(1), edge: z.string().min(1) }),
    })
    .optional(),
})

export type Post = z.infer<typeof postSchema>

/**
 * A post file's `post` export, checked. Throws (failing the build) on a missing or malformed field,
 * and when the file's slug doesn't match its folder.
 */
export function parsePost(value: unknown, expectedSlug?: string): Post {
  const post = postSchema.parse(value)
  if (expectedSlug !== undefined && post.slug !== expectedSlug) {
    throw new Error(`Blog post content/blog/${expectedSlug}/ exports slug "${post.slug}"`)
  }
  return post
}

/**
 * True when a post was revised after it was published (`updated` later than `published`): pages
 * then show "Updated <date>" with the revision date, otherwise just the publication date.
 */
export function isRevised(post: Pick<Post, 'published' | 'updated'>): boolean {
  return post.updated > post.published
}

/** The date a post's byline and card show: the revision date when revised, else the publication date. */
export function shownDate(post: Pick<Post, 'published' | 'updated'>): string {
  return isRevised(post) ? post.updated : post.published
}

/** Today's date in UTC as YYYY-MM-DD (posts go live at 00:00 UTC on their `published` date). */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * True once a post is live: its `published` date (UTC) is today or earlier. Posts can be merged
 * before their date; until then they are left out of every listing, and their page is a 404 on
 * production and shows a "Scheduled" banner on preview and local development.
 */
export function isPublished(post: Pick<Post, 'published'>, now: Date = new Date()): boolean {
  return post.published <= utcToday(now)
}

/** True for a dev-only placeholder post (content/blog/_placeholders, listed only under `next dev`). */
export function isPlaceholder(slug: string, sources: typeof BLOG_SOURCES = BLOG_SOURCES): boolean {
  return Boolean(sources[slug]?.[DEFAULT_LOCALE]?.placeholder)
}

/** The live posts that may appear in the sitemap, llms.txt and tag counts: never a placeholder. */
export function indexableSlugs(now: Date = new Date()): string[] {
  return publishedSlugs(now).filter((slug) => !isPlaceholder(slug))
}

/** The slugs of the posts that are live now (from the generated index, without loading the MDX). */
export function publishedSlugs(now: Date = new Date()): string[] {
  return BLOG_SLUGS.filter((slug) => {
    const published = BLOG_SOURCES[slug][DEFAULT_LOCALE]?.published
    return Boolean(published) && published <= utcToday(now)
  })
}

/** A neighbouring post for the "More posts" links: its slug and its title in the page's language. */
export interface AdjacentPost {
  slug: string
  title: string
}

/**
 * The live posts just older and just newer than `slug`, by `published` date, over the same list
 * the blog index shows (scheduled posts never appear). Titles come from the page locale's file,
 * else English; nothing is imported. `sources` is the generated index (a fixture in tests).
 */
export function adjacentPosts(
  slug: string,
  locale: string,
  now: Date = new Date(),
  sources: Record<string, Record<string, { title: string; published: string; navTitle?: string }>> = BLOG_SOURCES
): { older?: AdjacentPost; newer?: AdjacentPost } {
  const today = utcToday(now)
  const live = Object.keys(sources)
    .map((s) => ({ slug: s, published: sources[s][DEFAULT_LOCALE]?.published ?? '' }))
    .filter((p) => p.published && p.published <= today)
    .sort((a, b) => a.published.localeCompare(b.published) || a.slug.localeCompare(b.slug))
  const at = live.findIndex((p) => p.slug === slug)
  if (at < 0) return {}
  const pick = (i: number): AdjacentPost | undefined => {
    const p = live[i]
    if (!p) return undefined
    const file = sources[p.slug][locale] ?? sources[p.slug][DEFAULT_LOCALE]
    return { slug: p.slug, title: file.navTitle ?? file.title }
  }
  return { older: pick(at - 1), newer: pick(at + 1) }
}

/**
 * The tags used by live posts, most-used first (by number of posts, then in vocabulary order). The
 * blog index's topic chips show all of them; pass `limit` for a shorter list (the empty-search
 * suggestions).
 */
export function topTags(limit = Number.POSITIVE_INFINITY, now: Date = new Date()): BlogTag[] {
  const counts = new Map<BlogTag, number>()
  for (const slug of publishedSlugs(now)) {
    for (const tag of BLOG_SOURCES[slug][DEFAULT_LOCALE]?.tags ?? []) {
      if ((BLOG_TAG_SLUGS as readonly string[]).includes(tag)) counts.set(tag as BlogTag, (counts.get(tag as BlogTag) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || BLOG_TAG_SLUGS.indexOf(a[0]) - BLOG_TAG_SLUGS.indexOf(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag)
}

/** How many posts carry `tag` (from their English files, read without loading the MDX). */
export function tagPostCount(tag: BlogTag, now: Date = new Date()): number {
  return indexableSlugs(now).filter((slug) => BLOG_SOURCES[slug][DEFAULT_LOCALE]?.tags.includes(tag)).length
}

/** Every post's slug (its folder name), in folder order. */
export const BLOG_SLUGS: readonly string[] = Object.keys(BLOG_SOURCES)

/** True for the slug of a post that exists. */
export function isBlogSlug(value: unknown): value is string {
  return typeof value === 'string' && Object.hasOwn(BLOG_SOURCES, value)
}

/** The public locales that have their own file for a post (always includes English). */
export function postLocales(slug: string): string[] {
  const sources = BLOG_SOURCES[slug]
  if (!sources) return []
  return PUBLIC_LOCALES.filter((locale) => Object.hasOwn(sources, locale))
}

/** The locale whose file a page in `locale` shows: its own when it has one, else English. */
export function postContentLocale(slug: string, locale: string): string {
  const sources = BLOG_SOURCES[slug]
  return sources && Object.hasOwn(sources, locale) ? locale : DEFAULT_LOCALE
}

/**
 * A post's title, summary and image list as written in `locale`'s file (English when it has none),
 * read without loading the MDX: for sync callers such as the sitemap and llms.txt.
 */
export function postSummary(slug: string, locale: string = DEFAULT_LOCALE) {
  const sources = BLOG_SOURCES[slug]
  if (!sources) return undefined
  const { title, description, images } = sources[postContentLocale(slug, locale)]
  return { title, description, images }
}

/**
 * The image a post's index card shows, as the generator resolved it (the post's `cover`, else its
 * first 4:3 capture, with any `-dark` partner); the shown file's, else English. Null: the card
 * shows the TabMerger mark (never a cropped wide strip).
 */
export function cardCover(loaded: Pick<LoadedPost, 'post' | 'contentLocale'>, sources: typeof BLOG_SOURCES = BLOG_SOURCES): CardCover | null {
  const files = sources[loaded.post.slug]
  return files?.[loaded.contentLocale]?.cover ?? files?.[DEFAULT_LOCALE]?.cover ?? null
}

export interface LoadedPost {
  post: Post
  Content: MDXContent
  /** The locale of the file being shown (English when the page's locale has no file). */
  contentLocale: string
  /** Whole minutes to read the shown file. */
  readMinutes: number
  /** Public locales with their own file, for hreflang and the sitemap. */
  locales: string[]
}

/** A post as a page in `locale` shows it, or `null` for an unknown slug. */
export async function loadPost(slug: string, locale: string): Promise<LoadedPost | null> {
  if (!isBlogSlug(slug)) return null
  const contentLocale = postContentLocale(slug, locale)
  const source = BLOG_SOURCES[slug][contentLocale]
  const mod = (await source.load()) as { default: MDXContent; post?: unknown }
  return {
    post: parsePost(mod.post, slug),
    Content: mod.default,
    contentLocale,
    readMinutes: readMinutes(source.words),
    locales: postLocales(slug),
  }
}

/** Every live post as a page in `locale` shows it, newest first (scheduled ones left out). */
export async function loadAllPosts(locale: string, now: Date = new Date()): Promise<LoadedPost[]> {
  const posts = await Promise.all(publishedSlugs(now).map((slug) => loadPost(slug, locale)))
  return posts
    .filter((p): p is LoadedPost => p !== null)
    .sort((a, b) => b.post.published.localeCompare(a.post.published))
}
