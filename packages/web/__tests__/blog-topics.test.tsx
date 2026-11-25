/**
 * Topic chips and the all-topics page (/blog/tags): chips ordered by relevance (most posts first,
 * then alphabetically in the page's language), at most TOPIC_CHIP_LIMIT plus the current tag, then
 * "See all topics"; the all-topics page lists every tag in use with its article count (ICU
 * plurals), a locale-aware search with a live result line and an empty state, and is in the
 * sitemap. Over a fixture index, so nothing here names a real post.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

const fixtures = vi.hoisted(() => {
  const file = (slug: string, published: string, tags: string[]) => ({
    words: 400,
    title: `Post ${slug}`,
    description: 'D',
    published,
    images: [],
    tags,
    load: async () => ({
      default: () => null,
      post: {
        slug,
        title: `Post ${slug}`,
        seoTitle: 'S',
        description: 'D',
        shareSummary: 'S',
        dek: 'D',
        published,
        updated: published,
        testedOn: ['Chrome 157'],
        keyFacts: [],
        faq: [{ question: 'Q?', answer: 'A.' }],
        images: [{ src: `/blog/${slug}/shot.webp`, alt: 'Shot' }],
        tags,
        toc: [{ id: 'quick', label: 'Quick' }],
      },
    }),
  })
  return {
    BLOG_SOURCES: {
      a: { en: file('a', '2026-11-01', ['chrome', 'save-tabs', 'bookmarks']) },
      b: { en: file('b', '2026-11-02', ['chrome', 'save-tabs', 'edge']) },
      c: { en: file('c', '2026-11-03', ['chrome', 'firefox', 'tab-manager']) },
      // Scheduled: counted only under next dev.
      d: { en: file('d', '2026-12-25', ['chrome', 'research', 'comparison']) },
    },
  }
})

vi.mock('@/generated/blog', () => ({ BLOG_SOURCES: fixtures.BLOG_SOURCES, BLOG_BOXES: {} }))

import { TopicChips } from '@/components/blog/BlogListing'
import { TagDirectory } from '@/components/blog/TagDirectory'
import BlogTagsIndexPage, { generateMetadata } from '@/app/[locale]/(marketing)/blog/tags/page'
import sitemap from '@/app/sitemap'
import { listedTagCounts, tagPostCount } from '@/lib/blog/posts'
import { byRelevance, filterTags, TOPIC_CHIP_LIMIT, visibleChips, type TagEntry } from '@/lib/blog/tagOrder'
import { BLOG_TAG_SLUGS, type BlogTag } from '@/lib/blog/tags'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const entry = (tag: string, label: string, count: number) => ({ tag: tag as BlogTag, label, count })

describe('byRelevance', () => {
  it('orders by count, then alphabetically by label', () => {
    const ordered = byRelevance([entry('edge', 'edge', 1), entry('chrome', 'chrome', 3), entry('bookmarks', 'bookmarks', 1), entry('save-tabs', 'save-tabs', 2)], 'en')
    expect(ordered.map((e) => e.tag)).toEqual(['chrome', 'save-tabs', 'bookmarks', 'edge'])
  })

  it('sorts ties with the locale’s collation, accents included', () => {
    const fr = byRelevance([entry('research', 'recherche', 1), entry('comparison', 'comparatif', 1), entry('developers', 'développeurs', 1)], 'fr')
    expect(fr.map((e) => e.label)).toEqual(['comparatif', 'développeurs', 'recherche'])
    // German sorts "ü" with "u", not after "z".
    const de = byRelevance([entry('a', 'zubehör', 1), entry('b', 'übersicht', 1), entry('c', 'tabs', 1)] as TagEntry[], 'de')
    expect(de.map((e) => e.label)).toEqual(['tabs', 'übersicht', 'zubehör'])
  })
})

describe('visibleChips', () => {
  const ordered = BLOG_TAG_SLUGS.slice(0, 12)

  it('shows the first TOPIC_CHIP_LIMIT and counts the rest as hidden', () => {
    const { shown, hidden } = visibleChips(ordered)
    expect(shown).toEqual(ordered.slice(0, TOPIC_CHIP_LIMIT))
    expect(hidden).toBe(12 - TOPIC_CHIP_LIMIT)
  })

  it('adds the current tag when it is outside the first ones, and hides nothing when all fit', () => {
    const current = ordered[10]
    const { shown, hidden } = visibleChips(ordered, current)
    expect(shown).toEqual([...ordered.slice(0, TOPIC_CHIP_LIMIT), current])
    expect(hidden).toBe(12 - TOPIC_CHIP_LIMIT - 1)
    expect(visibleChips(ordered.slice(0, 3))).toEqual({ shown: ordered.slice(0, 3), hidden: 0 })
  })
})

describe('filterTags', () => {
  const tags = [entry('a', 'recherche', 1), entry('b', 'développeurs', 1), entry('c', 'save-tabs', 1), entry('d', 'Сравнение', 1)]
  it('ignores case, accents, a leading # and hyphens vs spaces', () => {
    expect(filterTags(tags, 'RECH', 'fr').map((t) => t.tag)).toEqual(['a'])
    expect(filterTags(tags, 'developp', 'fr').map((t) => t.tag)).toEqual(['b'])
    expect(filterTags(tags, '#save tabs', 'en').map((t) => t.tag)).toEqual(['c'])
    expect(filterTags(tags, 'сравн', 'ru').map((t) => t.tag)).toEqual(['d'])
  })
  it('returns everything for an empty query and nothing for a miss', () => {
    expect(filterTags(tags, '  ', 'en')).toHaveLength(4)
    expect(filterTags(tags, 'zzz', 'en')).toEqual([])
  })
})

describe('TopicChips', () => {
  const ordered = BLOG_TAG_SLUGS.slice(0, 12) as BlogTag[]

  it('shows at most TOPIC_CHIP_LIMIT tags, then See all topics', () => {
    render(<TopicChips tags={ordered} />)
    const nav = screen.getByRole('navigation', { name: 'Topics' })
    const links = within(nav).getAllByRole('link')
    // All posts + the chips + See all topics.
    expect(links).toHaveLength(1 + TOPIC_CHIP_LIMIT + 1)
    expect(within(nav).getByRole('link', { name: 'See all topics' })).toHaveAttribute('href', '/blog/tags')
  })

  it('keeps the current tag visible and marked when it is outside the first ones', () => {
    render(<TopicChips tags={ordered} current={ordered[10]} />)
    const nav = screen.getByRole('navigation', { name: 'Topics' })
    const current = within(nav).getByRole('link', { current: 'page' })
    expect(current).toHaveAttribute('href', `/blog/tags/${ordered[10]}`)
  })

  it('has no See all link when every tag fits', () => {
    render(<TopicChips tags={ordered.slice(0, 3)} />)
    expect(screen.queryByRole('link', { name: 'See all topics' })).toBeNull()
  })
})

describe('the all-topics page', () => {
  it('lists every tag in use with its article count, most used first, linking to its page', async () => {
    render(await BlogTagsIndexPage({ params: Promise.resolve({ locale: 'en' }) }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('All topics')
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/blog/tags/'))
    expect(links[0]).toHaveTextContent('#chrome')
    expect(links[0]).toHaveTextContent('3 articles')
    expect(links[1]).toHaveTextContent('#save-tabs')
    expect(links[1]).toHaveTextContent('2 articles')
    const bookmarks = links.find((a) => a.getAttribute('href') === '/blog/tags/bookmarks')!
    expect(bookmarks).toHaveTextContent('1 article')
    // The scheduled post's tags are not counted outside next dev.
    expect(links.some((a) => a.getAttribute('href') === '/blog/tags/research')).toBe(false)
    expect(links).toHaveLength(6)
    expect(screen.getByText('6 topics')).toBeInTheDocument()
  })

  it('counts scheduled posts under next dev, like the listing, but not for indexability', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(listedTagCounts().get('chrome')).toBe(4)
    expect(listedTagCounts().get('research')).toBe(1)
    expect(tagPostCount('chrome')).toBe(3)
    render(await BlogTagsIndexPage({ params: Promise.resolve({ locale: 'en' }) }))
    expect(screen.getByRole('link', { name: /#research/ })).toHaveTextContent('1 article')
  })

  it('is canonical on the English URL and in the sitemap', async () => {
    const meta = await generateMetadata()
    expect(meta.alternates?.canonical).toBe('/blog/tags')
    expect(meta.robots).toBeUndefined()
    expect(sitemap().map((e) => new URL(e.url).pathname)).toContain('/blog/tags')
  })
})

describe('TagDirectory search', () => {
  const messages = {
    searchLabel: 'Search topics',
    searchPlaceholder: 'Search topics',
    clearSearch: 'Clear search',
    results: '{count, plural, one {# topic} other {# topics}}',
    noResults: 'No topics match “{query}”',
  }
  const tags = [
    { tag: 'research', label: 'recherche', countLabel: '2 articles', href: '/blog/tags/research' },
    { tag: 'developers', label: 'développeurs', countLabel: '1 article', href: '/blog/tags/developers' },
  ]

  it('filters as you type, announces the count politely, shows an empty state and clears', () => {
    render(<TagDirectory locale="fr" tags={tags} messages={messages} />)
    const live = screen.getByText('2 topics')
    expect(live).toHaveAttribute('aria-live', 'polite')
    const input = screen.getByRole('searchbox', { name: 'Search topics' })
    fireEvent.change(input, { target: { value: 'develo' } })
    expect(screen.getByText('1 topic')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(screen.getByText('No topics match “zzz”')).toBeInTheDocument()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })
})
