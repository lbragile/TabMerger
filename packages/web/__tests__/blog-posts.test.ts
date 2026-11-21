/**
 * The blog's post files: every `content/blog/<slug>/<locale>.mdx` that exists parses, each locale
 * matches its English file on the fields that must not drift, dates and tags follow the rules, the
 * generated index agrees with the parsed post, and a locale without a file falls back to English.
 * Nothing here names a locale: it asserts invariants over whatever files exist.
 */
import { describe, expect, it } from 'vitest'
import { BLOG_SOURCES as GENERATED_SOURCES } from '@/generated/blog'
import { PUBLIC_LOCALES } from '@/i18n/locales'
import { BLOG_TAG_SLUGS, POST_TAGS_MAX, POST_TAGS_MIN } from '@/lib/blog/tags'
import {
  withoutPlaceholders,
  BLOG_SLUGS,
  isBlogSlug,
  isPublished,
  isRevised,
  parsePost,
  postContentLocale,
  postLocales,
  postSummary,
  publishedSlugs,
  shownDate,
  topTags,
  utcToday,
  type Post,
} from '@/lib/blog/posts'
import { hashtagWord } from '@/lib/blog/share'
import { BLOG_TAGS } from '@/lib/blog/tags'
import enMessages from '@/messages/en'
import { readPostSummary } from '@/scripts/generate-blog-index.mjs'
import { blogFiles, blogSource, loadBlogFile } from './helpers/blogMdx'

const files = blogFiles()
// A file that fails to parse is reported by its own test below and left out of the other checks.
const attempts = await Promise.all(
  files.map(async (f) => {
    const raw = (await loadBlogFile(f.slug, f.locale)).post
    try {
      return { ...f, post: parsePost(raw, f.slug), error: undefined as unknown }
    } catch (error) {
      return { ...f, post: undefined, error }
    }
  })
)
const loaded = attempts.filter((f): f is typeof f & { post: Post } => f.post !== undefined)
const english = (slug: string) => loaded.find((f) => f.slug === slug && f.locale === 'en')!.post
const byName = loaded.map((f) => [`${f.slug}/${f.locale}`, f] as const)

describe('post files', () => {
  it.each(attempts.map((f) => [`${f.slug}/${f.locale}`, f] as const))('%s exports a valid post', (_, f) => {
    if (f.error) throw f.error
  })

  it('has at least one post, each with an English file', () => {
    expect(BLOG_SLUGS.length).toBeGreaterThan(0)
    for (const slug of BLOG_SLUGS) expect(english(slug)).toBeDefined()
  })

  it('lists every file in the generated index, and nothing else', () => {
    // The generated module also lists the dev-only placeholders (flagged); the runtime list drops them.
    const indexed = Object.entries(withoutPlaceholders(GENERATED_SOURCES)).flatMap(([slug, locales]) => Object.keys(locales).map((l) => `${slug}/${l}`))
    expect(indexed.sort()).toEqual(files.map((f) => `${f.slug}/${f.locale}`).sort())
  })

  it.each(byName)('%s: tags are 3 to 8 from the vocabulary, with no repeats', (_, { post }) => {
    expect(post.tags.length).toBeGreaterThanOrEqual(POST_TAGS_MIN)
    expect(post.tags.length).toBeLessThanOrEqual(POST_TAGS_MAX)
    expect(new Set(post.tags).size).toBe(post.tags.length)
    for (const tag of post.tags) expect(BLOG_TAG_SLUGS).toContain(tag)
  })

  it.each(byName)('%s: at most 4 key facts, a share summary of at most 100 characters', (_, { post }) => {
    expect(post.keyFacts.length).toBeLessThanOrEqual(4)
    expect(post.shareSummary.length).toBeGreaterThan(0)
    expect(post.shareSummary.length).toBeLessThanOrEqual(100)
  })

  it.each(byName)('%s: published and updated are real dates, updated is not before published', (_, { post }) => {
    for (const date of [post.published, post.updated]) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(date)
    }
    expect(post.updated >= post.published).toBe(true)
  })

  it('gives no two posts the same published date', () => {
    const dates = BLOG_SLUGS.map((slug) => english(slug).published)
    expect(new Set(dates).size).toBe(dates.length)
  })

  it.each(byName.filter(([, f]) => f.locale !== 'en'))('%s matches English on slug, dates, images, FAQ count and tags', (_, f) => {
    const en = english(f.slug)
    expect(f.post.slug).toBe(en.slug)
    expect(f.post.published).toBe(en.published)
    expect(f.post.images.map((i) => i.src)).toEqual(en.images.map((i) => i.src))
    expect(f.post.faq).toHaveLength(en.faq.length)
    expect(f.post.tags).toEqual(en.tags)
    expect(f.post.toc.map((t) => t.id)).toEqual(en.toc.map((t) => t.id))
  })

  it.each(byName)('%s: the generated summary (read from the source text) agrees with the parsed post', (_, f) => {
    const summary = readPostSummary(blogSource(f.slug, f.locale))
    expect(summary).toEqual({
      title: f.post.title,
      description: f.post.description,
      shareSummary: f.post.shareSummary,
      published: f.post.published,
      images: f.post.images.map((i) => i.src),
      tags: f.post.tags,
      cover: f.post.cover && { src: f.post.cover.src, srcDark: f.post.cover.srcDark, extra: [] },
    })
    const indexed = GENERATED_SOURCES[f.slug][f.locale]
    expect([indexed.title, indexed.description, indexed.published]).toEqual([f.post.title, f.post.description, f.post.published])
    expect(indexed.words).toBeGreaterThan(100)
  })
})

describe('parsePost', () => {
  const base = english(BLOG_SLUGS[0]) as Post
  const bad = (patch: Record<string, unknown>) => () => parsePost({ ...base, ...patch })

  it('accepts the real post and checks the folder slug', () => {
    expect(parsePost(base, base.slug).slug).toBe(base.slug)
    expect(() => parsePost(base, 'another-folder')).toThrow(/exports slug/)
  })

  it.each([
    ['title', undefined],
    ['seoTitle', undefined],
    ['description', ''],
    ['shareSummary', undefined],
    ['dek', undefined],
    ['published', undefined],
    ['updated', undefined],
    ['testedOn', []],
    ['faq', []],
    ['images', []],
    ['toc', []],
  ])('requires %s', (field, value) => {
    expect(bad({ [field]: value })).toThrow()
  })

  it('rejects a malformed date, an uppercase slug and a non-https source', () => {
    expect(bad({ published: '2026-1-9' })).toThrow()
    expect(bad({ slug: 'Not-Lowercase' })).toThrow()
    expect(bad({ sources: [{ title: 'x', publisher: 'y', url: 'http://example.com', checked: '2026-01-01' }] })).toThrow()
  })

  it('limits tags to 3-8 vocabulary words without repeats', () => {
    const [a, b, c, ...rest] = BLOG_TAG_SLUGS
    expect(bad({ tags: [a, b] })).toThrow()
    expect(bad({ tags: [a, b, c] })).not.toThrow()
    expect(bad({ tags: [a, a, b] })).toThrow()
    expect(bad({ tags: [a, b, 'not-a-tag'] })).toThrow()
    expect(bad({ tags: [a, b, c, ...rest.slice(0, 5)] })).not.toThrow()
    expect(bad({ tags: [a, b, c, ...rest.slice(0, 6)] })).toThrow()
  })

  it('limits key facts to 4 and the share summary to 100 characters', () => {
    const fact = { text: 't', source: 's' }
    expect(bad({ keyFacts: [fact, fact, fact, fact] })).not.toThrow()
    expect(bad({ keyFacts: [fact, fact, fact, fact, fact] })).toThrow()
    expect(bad({ shareSummary: 'x'.repeat(100) })).not.toThrow()
    expect(bad({ shareSummary: 'x'.repeat(101) })).toThrow()
  })

  it('defaults sources and browser sections to empty lists', () => {
    const { sources, browserSections, ...rest } = base
    void sources
    void browserSections
    const parsed = parsePost(rest)
    expect(parsed.sources).toEqual([])
    expect(parsed.browserSections).toEqual([])
  })
})

describe('dates and revisions', () => {
  it('isPublished: the day before is scheduled, the same day and later are live (UTC)', () => {
    const post = { published: '2026-11-19' }
    expect(isPublished(post, new Date('2026-11-18T23:59:59Z'))).toBe(false)
    expect(isPublished(post, new Date('2026-11-19T00:00:00Z'))).toBe(true)
    expect(isPublished(post, new Date('2026-11-19T23:59:59Z'))).toBe(true)
    expect(isPublished(post, new Date('2026-11-20T00:00:00Z'))).toBe(true)
  })

  it('utcToday ignores the local timezone', () => {
    expect(utcToday(new Date('2026-11-19T23:30:00-05:00'))).toBe('2026-11-20')
  })

  it('shows the revision date only when updated is later than published', () => {
    expect(isRevised({ published: '2026-11-19', updated: '2026-11-19' })).toBe(false)
    expect(shownDate({ published: '2026-11-19', updated: '2026-11-19' })).toBe('2026-11-19')
    expect(isRevised({ published: '2026-11-19', updated: '2026-12-01' })).toBe(true)
    expect(shownDate({ published: '2026-11-19', updated: '2026-12-01' })).toBe('2026-12-01')
  })
})

describe('locale fallback', () => {
  const slug = BLOG_SLUGS[0]

  it('always has English, and only lists public locales that have a file', () => {
    expect(postLocales(slug)).toContain('en')
    for (const locale of postLocales(slug)) expect(files.some((f) => f.slug === slug && f.locale === locale)).toBe(true)
  })

  it('serves a locale with its own file that file, and any other locale the English one', () => {
    for (const locale of PUBLIC_LOCALES) {
      const own = files.some((f) => f.slug === slug && f.locale === locale)
      expect(postContentLocale(slug, locale)).toBe(own ? locale : 'en')
      expect(postSummary(slug, locale)?.title).toBe(GENERATED_SOURCES[slug][own ? locale : 'en'].title)
    }
    expect(postContentLocale(slug, 'xx')).toBe('en')
  })

  it('knows its slugs and answers nothing for an unknown one', () => {
    expect(isBlogSlug(slug)).toBe(true)
    expect(isBlogSlug('no-such-post')).toBe(false)
    expect(isBlogSlug('constructor')).toBe(false)
    expect(isBlogSlug(undefined)).toBe(false)
    expect(postLocales('no-such-post')).toEqual([])
    expect(postSummary('no-such-post')).toBeUndefined()
  })
})

describe('share hashtags', () => {
  it('lead with #TabManagement for the first post (its first tag is tab-management)', () => {
    const first = english('save-all-open-tabs')
    const label = (enMessages as unknown as { blog: { tags: Record<string, string> } }).blog.tags[BLOG_TAGS[first.tags[0]]]
    expect(hashtagWord(label)).toBe('TabManagement')
  })
})

describe('topic chips (topTags)', () => {
  const usedTags = () => new Set(publishedSlugs().flatMap((slug) => GENERATED_SOURCES[slug]?.en?.tags ?? []))

  it('lists every tag used by a live post by default, each once', () => {
    const tags = topTags()
    expect(new Set(tags).size).toBe(tags.length)
    expect(new Set(tags)).toEqual(usedTags())
    // More than the old cap of five, so the index really shows them all.
    expect(tags.length).toBeGreaterThan(5)
  })

  it('orders by number of posts, then vocabulary order, and honours a limit', () => {
    const tags = topTags()
    const count = (tag: string) => publishedSlugs().filter((slug) => GENERATED_SOURCES[slug]?.en?.tags.includes(tag)).length
    for (let i = 1; i < tags.length; i++) {
      const [a, b] = [tags[i - 1], tags[i]]
      expect(count(a) > count(b) || (count(a) === count(b) && BLOG_TAG_SLUGS.indexOf(a) < BLOG_TAG_SLUGS.indexOf(b))).toBe(true)
    }
    expect(topTags(3)).toEqual(tags.slice(0, 3))
  })
})
