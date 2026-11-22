/**
 * Scheduled posts, tag pages and hreflang/canonical rules, over a fixture index (so nothing here
 * names a real post or locale file):
 * - a post whose `published` date is still ahead is left out of the index, tag pages and their
 *   counts, the sitemap and llms.txt; its page is a 404 on production and shows the banner on
 *   preview and local development
 * - under `next dev` only (and not with BLOG_DEV_SCHEDULED=0) the index, tag pages, topic chips and
 *   previous/next links list it, its card flagged "Scheduled for <date>"; tag counts, noindex, the
 *   sitemap and llms.txt still leave it out
 * - a tag page is noindex until 3 posts carry the tag, 404 for a tag outside the vocabulary and is
 *   in the sitemap only when indexable
 * - a locale WITH its own file is canonical on its own URL and listed in hreflang and the sitemap;
 *   a locale WITHOUT one canonicalises to English and is in neither
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const fixtures = vi.hoisted(() => {
  const makePost = (slug: string, published: string, tags: string[], title: string) => ({
    slug,
    title,
    seoTitle: `${title} (SEO)`,
    description: `About ${title}.`,
    shareSummary: 'Short.',
    dek: 'Dek.',
    published,
    updated: published,
    testedOn: ['Chrome 157.0.1'],
    keyFacts: [],
    faq: [{ question: 'Q?', answer: 'A.' }],
    images: [{ src: `/blog/${slug}/shot.webp`, alt: 'Shot' }],
    ogImage: { src: `/blog/${slug}/og.png`, alt: 'Card' },
    tags,
    sources: [{ title: 'Doc', publisher: 'Pub', url: 'https://example.com/doc', checked: published }],
    toc: [{ id: 'quick', label: 'Quick' }],
    browserSections: [],
  })
  const file = (post: ReturnType<typeof makePost>) => ({
    words: 460,
    title: post.title,
    description: post.description,
    published: post.published,
    images: post.images.map((i) => i.src),
    tags: post.tags,
    load: async () => ({ default: () => null, post }),
  })
  const a = makePost('live-a', '2026-11-01', ['chrome', 'save-tabs', 'bookmarks'], 'Live A')
  const aDe = makePost('live-a', '2026-11-01', ['chrome', 'save-tabs', 'bookmarks'], 'Live A auf Deutsch')
  const b = makePost('live-b', '2026-11-10', ['chrome', 'save-tabs', 'edge'], 'Live B')
  const c = makePost('live-c', '2026-11-12', ['chrome', 'bookmarks', 'tab-management'], 'Live C')
  const s = makePost('scheduled-d', '2026-12-25', ['chrome', 'firefox', 'save-tabs'], 'Scheduled D')
  return {
    BLOG_SOURCES: {
      'live-a': { en: file(a), de: file(aDe) },
      'live-b': { en: file(b) },
      'live-c': { en: file(c) },
      'scheduled-d': { en: file(s) },
    },
  }
})

vi.mock('@/generated/blog', () => ({ BLOG_SOURCES: fixtures.BLOG_SOURCES, BLOG_BOXES: {} }))
// PostSources is an async Server Component, which React can't render under the client lightbox in jsdom.
vi.mock('@/components/blog/PostSources', () => ({ PostSources: () => null }))

import sitemap from '@/app/sitemap'
import { buildLlmsTxt } from '@/app/llms.txt/route'
import BlogIndexPage from '@/app/[locale]/(marketing)/blog/page'
import { indexOrder } from '@/components/blog/BlogIndexView'
import BlogPostPage, { generateMetadata as postMetadata } from '@/app/[locale]/(marketing)/blog/[slug]/page'
import BlogTagPage, { generateMetadata as tagMetadata } from '@/app/[locale]/(marketing)/blog/tags/[tag]/page'
import {
  adjacentPosts,
  loadAllPosts,
  loadPost,
  postLocales,
  publishedSlugs,
  scheduledPreviewEnabled,
  tagPostCount,
  topTags,
} from '@/lib/blog/posts'
import { blogPostMetadata } from '@/lib/blog/metadata'
import { blogIndexJsonLd, blogPostingJsonLd } from '@/lib/blog/jsonLd'

const NOW = new Date('2026-11-20T12:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const jsonLd = (container: HTMLElement) =>
  [...container.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent ?? '{}') as Record<string, unknown>)

describe('scheduled posts are not public', () => {
  it('are left out of the slugs, tag counts, index and neighbours', async () => {
    expect(publishedSlugs()).toEqual(['live-a', 'live-b', 'live-c'])
    expect(tagPostCount('chrome')).toBe(3)
    expect(tagPostCount('firefox')).toBe(0)
    expect((await loadAllPosts('en')).map((p) => p.post.slug)).toEqual(['live-c', 'live-b', 'live-a'])
    expect(adjacentPosts('live-c', 'en')).toEqual({ older: { slug: 'live-b', title: 'Live B' }, newer: undefined })
    expect(adjacentPosts('scheduled-d', 'en')).toEqual({})
  })

  it('go live at 00:00 UTC on their date, and not a day before', () => {
    vi.setSystemTime(new Date('2026-12-24T23:59:59Z'))
    expect(publishedSlugs()).not.toContain('scheduled-d')
    vi.setSystemTime(new Date('2026-12-25T00:00:00Z'))
    expect(publishedSlugs()).toContain('scheduled-d')
    expect(tagPostCount('firefox')).toBe(1)
    vi.setSystemTime(new Date('2026-12-26T00:00:00Z'))
    expect(publishedSlugs()).toContain('scheduled-d')
  })

  it('are not on the blog index page', async () => {
    const { container } = render(await BlogIndexPage({ params: Promise.resolve({ locale: 'en' }) }))
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(links).toContain('/blog/live-a')
    expect(links.some((href) => href?.includes('scheduled-d'))).toBe(false)
    expect(screen.queryByText('Scheduled D')).toBeNull()
    const blog = jsonLd(container).find((d) => d['@type'] === 'Blog') as { blogPost: { headline: string }[] }
    expect(blog.blogPost.map((p) => p.headline).sort()).toEqual(['Live A', 'Live B', 'Live C'])
  })

  it('are not in the sitemap or llms.txt', () => {
    const urls = sitemap().map((entry) => entry.url)
    expect(urls.some((u) => u.includes('live-a'))).toBe(true)
    expect(urls.some((u) => u.includes('scheduled-d'))).toBe(false)
    const llms = buildLlmsTxt('https://tabmerger.com')
    expect(llms).toContain('[Live A](https://tabmerger.com/blog/live-a)')
    expect(llms).not.toContain('scheduled-d')
    expect(llms).not.toContain('Scheduled D')
  })

  it('are in the sitemap and llms.txt once their date has come', () => {
    vi.setSystemTime(new Date('2026-12-25T08:00:00Z'))
    expect(sitemap().some((entry) => entry.url.includes('scheduled-d'))).toBe(true)
    expect(buildLlmsTxt('https://tabmerger.com')).toContain('/blog/scheduled-d')
  })

  it('are a 404 on production', async () => {
    vi.stubEnv('DEPLOY_ENV', 'production')
    await expect(BlogPostPage({ params: Promise.resolve({ locale: 'en', slug: 'scheduled-d' }) })).rejects.toThrow(/404/)
  })

  it.each(['preview', 'development'])('show a banner on %s, are never indexed there, and live posts have none', async (env) => {
    vi.stubEnv('DEPLOY_ENV', env)
    const { container } = render(await BlogPostPage({ params: Promise.resolve({ locale: 'en', slug: 'scheduled-d' }) }))
    expect(screen.getByRole('note')).toHaveTextContent('Scheduled for December 25, 2026')
    expect(container.querySelector('h1')).toHaveTextContent('Scheduled D')
    expect((await postMetadata({ params: Promise.resolve({ locale: 'en', slug: 'scheduled-d' }) })).robots).toEqual({
      index: false,
      follow: false,
    })
    expect((await postMetadata({ params: Promise.resolve({ locale: 'en', slug: 'live-a' }) })).robots).toBeUndefined()
  })

  it('a live post shows no banner on production', async () => {
    vi.stubEnv('DEPLOY_ENV', 'production')
    render(await BlogPostPage({ params: Promise.resolve({ locale: 'en', slug: 'live-a' }) }))
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Live A')
  })

  it('an unknown slug is a 404 with no metadata', async () => {
    await expect(BlogPostPage({ params: Promise.resolve({ locale: 'en', slug: 'nope' }) })).rejects.toThrow(/404/)
    expect(await postMetadata({ params: Promise.resolve({ locale: 'en', slug: 'nope' }) })).toEqual({})
  })
})

describe('scheduled posts under next dev', () => {
  const tagParams = (tag: string) => ({ params: Promise.resolve({ locale: 'en', tag }) })
  const indexLinks = async () => {
    const { container } = render(await BlogIndexPage({ params: Promise.resolve({ locale: 'en' }) }))
    return [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))
  }

  it('the gate is next dev only, with BLOG_DEV_SCHEDULED=0 as the opt-out', () => {
    expect(scheduledPreviewEnabled({ NODE_ENV: 'development' })).toBe(true)
    expect(scheduledPreviewEnabled({ NODE_ENV: 'development', BLOG_DEV_SCHEDULED: '1' })).toBe(true)
    expect(scheduledPreviewEnabled({ NODE_ENV: 'development', BLOG_DEV_SCHEDULED: '0' })).toBe(false)
    expect(scheduledPreviewEnabled({ NODE_ENV: 'production' })).toBe(false)
    expect(scheduledPreviewEnabled({ NODE_ENV: 'test' })).toBe(false)
    expect(scheduledPreviewEnabled({})).toBe(false)
  })

  it('lists them on the index, flagged "Scheduled for <date>", and live cards carry no flag', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const links = await indexLinks()
    expect(links).toContain('/blog/scheduled-d')
    expect(links).toContain('/blog/live-a')
    expect(screen.getAllByText(/^Scheduled for /)).toHaveLength(1)
    expect(screen.getByText('Scheduled for December 25, 2026')).toBeInTheDocument()
    expect((await loadAllPosts('en')).map((p) => p.post.slug)).toEqual(['scheduled-d', 'live-c', 'live-b', 'live-a'])
  })

  it('features the newest LIVE post, and lists the scheduled one first under More guides', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { container } = render(await BlogIndexPage({ params: Promise.resolve({ locale: 'en' }) }))
    const cards = [...container.querySelectorAll('article[aria-labelledby^="post-"]')]
    expect(cards.map((c) => c.getAttribute('aria-labelledby'))).toEqual(['post-live-c', 'post-scheduled-d', 'post-live-b', 'post-live-a'])
    // The first card is the featured panel: the live post, no flag.
    expect(cards[0]).toHaveTextContent('Latest guide')
    expect(cards[0]).not.toHaveTextContent('Scheduled for')
    expect(cards[1]).toHaveTextContent('Scheduled for December 25, 2026')
    expect(cards[1]).not.toHaveTextContent('Latest guide')
    expect(screen.getByRole('heading', { name: /^More guides/ })).toHaveTextContent('3')
  })

  it('features nothing when every listed post is scheduled', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'))
    const { container } = render(await BlogIndexPage({ params: Promise.resolve({ locale: 'en' }) }))
    expect(screen.queryByText('Latest guide')).toBeNull()
    const cards = [...container.querySelectorAll('article[aria-labelledby^="post-"]')]
    expect(cards.map((c) => c.getAttribute('aria-labelledby'))).toEqual(['post-scheduled-d', 'post-live-c', 'post-live-b', 'post-live-a'])
    expect(screen.getAllByText(/^Scheduled for /)).toHaveLength(4)
    expect(screen.getByRole('heading', { name: /^More guides/ })).toHaveTextContent('4')
  })

  it('indexOrder moves the newest live post first and keeps the rest in order', () => {
    const p = (slug: string, published: string) => ({ post: { slug, published } }) as never
    const now = new Date('2026-11-20T12:00:00Z')
    const order = (posts: never[]) => indexOrder(posts, now).map((x: { post: { slug: string } }) => x.post.slug)
    expect(order([p('s2', '2026-12-02'), p('s1', '2026-12-01'), p('l2', '2026-11-19'), p('l1', '2026-11-01')])).toEqual(['l2', 's2', 's1', 'l1'])
    expect(order([p('l2', '2026-11-19'), p('l1', '2026-11-01')])).toEqual(['l2', 'l1'])
    expect(order([p('s1', '2026-12-01')])).toEqual(['s1'])
    expect(order([])).toEqual([])
  })

  it('lists them on tag pages and in the topic chips, but tag counts and noindex stay live-only', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { container } = render(await BlogTagPage(tagParams('firefox')))
    expect(container.textContent).toContain('Scheduled D')
    expect(screen.getByText('Scheduled for December 25, 2026')).toBeInTheDocument()
    expect(topTags()).toContain('firefox')
    expect(tagPostCount('firefox')).toBe(0)
    expect((await tagMetadata(tagParams('firefox'))).robots).toEqual({ index: false, follow: true })
  })

  it('include them in the previous/next links', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(adjacentPosts('live-c', 'en').newer).toEqual({ slug: 'scheduled-d', title: 'Scheduled D' })
    expect(adjacentPosts('scheduled-d', 'en')).toEqual({ older: { slug: 'live-c', title: 'Live C' }, newer: undefined })
  })

  it('never put them in the sitemap or llms.txt', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(sitemap().some((entry) => entry.url.includes('scheduled-d'))).toBe(false)
    expect(buildLlmsTxt('https://tabmerger.com')).not.toContain('scheduled-d')
  })

  it('stay unlisted with BLOG_DEV_SCHEDULED=0', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('BLOG_DEV_SCHEDULED', '0')
    expect(await indexLinks()).not.toContain('/blog/scheduled-d')
    expect(screen.queryByText(/^Scheduled for /)).toBeNull()
  })

  it.each([
    ['production', 'production'],
    ['production', 'preview'],
    ['test', ''],
  ])('stay unlisted on a %s build (deployment "%s")', async (nodeEnv, deployEnv) => {
    vi.stubEnv('NODE_ENV', nodeEnv)
    vi.stubEnv('DEPLOY_ENV', deployEnv)
    expect(await indexLinks()).not.toContain('/blog/scheduled-d')
    expect(screen.queryByText(/^Scheduled for /)).toBeNull()
    expect(topTags()).not.toContain('firefox')
    expect(adjacentPosts('live-c', 'en').newer).toBeUndefined()
  })
})

describe('tag pages', () => {
  const params = (tag: string) => ({ params: Promise.resolve({ locale: 'en', tag }) })

  it('are noindex, follow below 3 posts, indexable from 3', async () => {
    expect((await tagMetadata(params('edge'))).robots).toEqual({ index: false, follow: true })
    expect((await tagMetadata(params('firefox'))).robots).toEqual({ index: false, follow: true })
    expect((await tagMetadata(params('chrome'))).robots).toBeUndefined()
  })

  it('count only live posts, listing them without the scheduled one', async () => {
    const { container } = render(await BlogTagPage(params('chrome')))
    expect(container.querySelector('h1')).toHaveTextContent('chrome')
    expect(container.textContent).toContain('3 guides')
    expect(container.textContent).toContain('Live A')
    expect(container.textContent).not.toContain('Scheduled D')
  })

  it('carry a BreadcrumbList that ends at the tag', async () => {
    const { container } = render(await BlogTagPage(params('chrome')))
    const trail = jsonLd(container).find((d) => d['@type'] === 'BreadcrumbList') as { itemListElement: { name: string; item: string }[] }
    expect(trail.itemListElement.map((i) => i.name)).toEqual(['TabMerger', 'Blog', '#chrome'])
    expect(trail.itemListElement[2].item).toMatch(/\/blog\/tags\/chrome$/)
  })

  it('are a 404 for a tag outside the vocabulary', async () => {
    await expect(BlogTagPage(params('not-a-tag'))).rejects.toThrow(/404/)
    expect(await tagMetadata(params('not-a-tag'))).toEqual({})
  })

  it('are in the sitemap only when indexable', () => {
    const urls = sitemap().map((entry) => entry.url)
    expect(urls.filter((u) => u.includes('/blog/tags/'))).toEqual([expect.stringMatching(/\/blog\/tags\/chrome$/)])
    vi.setSystemTime(new Date('2026-12-25T00:00:00Z'))
    // save-tabs now has a third live post: a, b and the one that just went live.
    expect(sitemap().map((e) => e.url).filter((u) => u.includes('/blog/tags/')).some((u) => u.endsWith('/save-tabs'))).toBe(true)
  })
})

describe('hreflang, canonical and the sitemap per locale', () => {
  const metadata = async (slug: string, locale: string) => blogPostMetadata((await loadPost(slug, locale))!, locale)

  it('a locale with its own file is canonical on its own URL and lists every locale that has a file', async () => {
    const de = await metadata('live-a', 'de')
    expect(de.alternates?.canonical).toBe('/de/blog/live-a')
    expect(de.alternates?.languages).toEqual({ en: '/blog/live-a', de: '/de/blog/live-a', 'x-default': '/blog/live-a' })
    expect((de.openGraph as { url: string }).url).toBe('/de/blog/live-a')
  })

  it('a locale without a file canonicalises to English and is not an alternate', async () => {
    const fr = await metadata('live-a', 'fr')
    expect(fr.alternates?.canonical).toBe('/blog/live-a')
    expect(fr.alternates?.languages).toEqual({ en: '/blog/live-a', 'x-default': '/blog/live-a' })
    expect((fr.openGraph as { url: string }).url).toBe('/blog/live-a')
    const en = await metadata('live-b', 'en')
    expect(en.alternates?.canonical).toBe('/blog/live-b')
    expect(Object.keys(en.alternates?.languages ?? {}).sort()).toEqual(['en', 'x-default'])
  })

  it('the sitemap lists a post once per locale that has a file, each pointing at every such locale', () => {
    const entries = sitemap().filter((e) => e.url.includes('/blog/live-'))
    const a = entries.filter((e) => e.url.includes('live-a'))
    expect(a.map((e) => new URL(e.url).pathname).sort()).toEqual(['/blog/live-a', '/de/blog/live-a'])
    for (const entry of a) {
      expect(Object.keys(entry.alternates?.languages ?? {}).sort()).toEqual(postLocales('live-a').sort())
    }
    expect(entries.filter((e) => e.url.includes('live-b'))).toHaveLength(1)
    expect(entries.some((e) => e.url.includes('/fr/blog/'))).toBe(false)
  })

  it('the sitemap lists each post’s captures for the image sitemap', () => {
    const entry = sitemap().find((e) => new URL(e.url).pathname === '/blog/live-b')!
    expect(entry.images?.map((u) => new URL(u).pathname)).toEqual(['/blog/live-b/shot.webp'])
  })
})

describe('social cards and structured data', () => {
  it('describes an article with its canonical URL and tags', async () => {
    const loaded = (await loadPost('live-a', 'en'))!
    const meta = await blogPostMetadata(loaded, 'en', ['chrome', 'save tabs', 'bookmarks'])
    const og = meta.openGraph as Record<string, unknown>
    expect(og.type).toBe('article')
    expect(og.url).toBe('/blog/live-a')
    expect(og.tags).toEqual(['chrome', 'save tabs', 'bookmarks'])
    expect(og.publishedTime).toBe('2026-11-01')
    expect(og.authors).toEqual(['https://github.com/lbragile'])
  })

  it('omits article tags when there are none', async () => {
    const meta = await blogPostMetadata((await loadPost('live-a', 'en'))!, 'en')
    expect((meta.openGraph as Record<string, unknown>).tags).toBeUndefined()
  })

  it('page metadata passes the post’s tag labels as article:tag', async () => {
    const meta = await postMetadata({ params: Promise.resolve({ locale: 'en', slug: 'live-c' }) })
    expect((meta.openGraph as { tags: string[] }).tags).toEqual(['chrome', 'bookmarks', 'tab management'])
  })

  it('BlogPosting names lbragile as the author and carries the sources as citations and the tags as keywords', async () => {
    const { post } = (await loadPost('live-a', 'en'))!
    const data = blogPostingJsonLd(post, '/blog/live-a', 'en', ['chrome', 'save tabs'], new URL('https://tabmerger.com'))
    expect(data['@type']).toBe('BlogPosting')
    expect(data.author).toEqual({ '@type': 'Person', name: 'lbragile', url: 'https://github.com/lbragile' })
    expect(data.keywords).toBe('chrome, save tabs')
    expect(data.citation).toEqual([
      { '@type': 'CreativeWork', name: 'Doc', url: 'https://example.com/doc', publisher: { '@type': 'Organization', name: 'Pub' } },
    ])
    expect(data.datePublished).toBe('2026-11-01')
    expect(data.inLanguage).toBe('en')
    expect(data.url).toBe('https://tabmerger.com/blog/live-a')
  })

  it('BlogPosting leaves out keywords and citations when there are none', async () => {
    const { post } = (await loadPost('live-a', 'en'))!
    const data = blogPostingJsonLd({ ...post, sources: [] }, '/blog/live-a', 'en', [], new URL('https://tabmerger.com'))
    expect(data).not.toHaveProperty('keywords')
    expect(data).not.toHaveProperty('citation')
  })

  it('the post page emits BlogPosting, FAQPage and BreadcrumbList data', async () => {
    const { container } = render(await BlogPostPage({ params: Promise.resolve({ locale: 'en', slug: 'live-a' }) }))
    const types = jsonLd(container).map((d) => d['@type'])
    expect(types).toEqual(expect.arrayContaining(['BlogPosting', 'FAQPage', 'BreadcrumbList']))
    const posting = jsonLd(container).find((d) => d['@type'] === 'BlogPosting') as Record<string, unknown>
    expect((posting.author as { name: string }).name).toBe('lbragile')
    expect(posting.keywords).toBe('chrome, save tabs, bookmarks')
  })

  it('a locale without a file shows the English file marked lang="en", with an English canonical in its data', async () => {
    const { container } = render(await BlogPostPage({ params: Promise.resolve({ locale: 'fr', slug: 'live-a' }) }))
    expect(container.querySelector('header[lang="en"]')).not.toBeNull()
    const posting = jsonLd(container).find((d) => d['@type'] === 'BlogPosting') as Record<string, unknown>
    expect(posting.url).toMatch(/\/blog\/live-a$/)
    expect(posting.url).not.toMatch(/\/fr\//)
  })

  it('the Blog data on the index lists each post with its author', () => {
    const post = (slug: string) => ({ post: { title: slug, published: '2026-11-01', updated: '2026-11-02' } as never, path: `/blog/${slug}` })
    const data = blogIndexJsonLd([post('x'), post('y')], '/blog', 'Blog', new URL('https://tabmerger.com'))
    expect(data['@type']).toBe('Blog')
    expect(data.blogPost.map((p) => p.url)).toEqual(['https://tabmerger.com/blog/x', 'https://tabmerger.com/blog/y'])
    expect(data.blogPost[0].author.name).toBe('lbragile')
    expect(data.blogPost[0].dateModified).toBe('2026-11-02')
  })
})
