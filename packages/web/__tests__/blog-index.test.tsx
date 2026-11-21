/**
 * The blog index (design A) and its pagination: paging math and the dev-only page size, the
 * featured panel and list rows (cover = images[0], tested-on pills, tags capped at 4 + "+N"), the
 * pager (ends, aria-current, "Page X of Y", RTL arrows), the page/1 redirect and out-of-range 404,
 * and each page's title and canonical.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { FeaturedPost, Pager, PostRow } from '@/components/blog/BlogListing'
import { listingMetadata, resolveListingPage } from '@/components/blog/BlogIndexView'
import {
  POSTS_PER_PAGE,
  blogIndexPagePath,
  blogPageSize,
  blogTagPagePath,
  laterPages,
  pageCount,
  pageItems,
  parsePageParam,
} from '@/lib/blog/paging'
import type { LoadedPost, Post } from '@/lib/blog/posts'
import en from '@/messages/en'

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  permanentRedirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT 308 ${to}`)
  },
}))

// The listing loads posts through their MDX modules, which Vitest can't import: one live post.
vi.mock('@/lib/blog/posts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAllPosts: async () => [loaded],
}))

const post = {
  slug: 'save-all-open-tabs',
  title: 'How to save all open tabs and get them back later',
  description: 'Save every open tab.',
  published: '2026-11-19',
  updated: '2026-11-19',
  testedOn: ['Chrome 157.0.8103.79', 'Edge 157.0.4341.60', 'Firefox 159.0.1'],
  images: [{ src: '/blog/save-all-open-tabs/chrome-bookmarks-folder.webp', alt: 'Bookmarks' }],
  tags: ['tab-management', 'save-tabs', 'restore-closed-tabs', 'bookmarks', 'browser-productivity', 'chrome'],
} as unknown as Post
const loaded = { post, Content: () => null, contentLocale: 'en', readMinutes: 4, locales: ['en'] } as unknown as LoadedPost

describe('paging', () => {
  it('pages hold 10 posts; page 1 is /blog', () => {
    expect(POSTS_PER_PAGE).toBe(10)
    expect(pageCount(0, 10)).toBe(1)
    expect(pageCount(10, 10)).toBe(1)
    expect(pageCount(11, 10)).toBe(2)
    expect(pageItems([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4])
    expect(laterPages(25, 10)).toEqual([2, 3])
    expect(blogIndexPagePath(1)).toBe('/blog')
    expect(blogIndexPagePath(3)).toBe('/blog/page/3')
    expect(blogTagPagePath('chrome', 1)).toBe('/blog/tags/chrome')
    expect(blogTagPagePath('chrome', 2)).toBe('/blog/tags/chrome/page/2')
  })

  it.each([
    ['2', 2],
    ['10', 10],
    ['0', null],
    ['01', null],
    ['-1', null],
    ['1.5', null],
    ['x', null],
  ])('parsePageParam(%s) → %s', (raw, expected) => {
    expect(parsePageParam(raw)).toBe(expected)
  })

  it('takes BLOG_DEV_PLACEHOLDERS_PER_PAGE only under next dev', () => {
    expect(blogPageSize({ NODE_ENV: 'development', BLOG_DEV_PLACEHOLDERS_PER_PAGE: '2' })).toBe(2)
    expect(blogPageSize({ NODE_ENV: 'development' })).toBe(10)
    expect(blogPageSize({ NODE_ENV: 'development', BLOG_DEV_PLACEHOLDERS_PER_PAGE: 'abc' })).toBe(10)
    expect(blogPageSize({ NODE_ENV: 'development', BLOG_DEV_PLACEHOLDERS_PER_PAGE: '0' })).toBe(10)
    expect(blogPageSize({ NODE_ENV: 'production', BLOG_DEV_PLACEHOLDERS_PER_PAGE: '2' })).toBe(10)
    expect(blogPageSize({ NODE_ENV: 'test', BLOG_DEV_PLACEHOLDERS_PER_PAGE: '2' })).toBe(10)
  })
})

describe('featured panel and rows', () => {
  it('the featured post: kicker, title link, cover from images[0], pills, 4 tags + "+N"', () => {
    const { container } = render(<FeaturedPost loaded={loaded} />)
    expect(screen.getByText('Latest guide')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: post.title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: post.title })).toHaveAttribute('href', '/blog/save-all-open-tabs')
    const cover = container.querySelector('img')!
    expect(cover.getAttribute('src')).toContain('chrome-bookmarks-folder.webp')
    expect(cover).toHaveAttribute('alt', '')
    expect(within(screen.getByRole('list', { name: 'Tested on' })).getAllByRole('listitem')).toHaveLength(3)
    const tags = screen.getByRole('list', { name: 'Topics' })
    expect(within(tags).getAllByRole('link')).toHaveLength(5)
    expect(within(tags).getByRole('link', { name: '2 more tags' })).toHaveTextContent('+2')
  })

  it('a list row: h3 title link, the same cover, pills and capped tags', () => {
    render(<PostRow loaded={loaded} />)
    expect(screen.getByRole('heading', { level: 3, name: post.title })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Tested on' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Topics' })).getAllByRole('link')).toHaveLength(5)
  })
})

describe('Pager', () => {
  const hrefFor = (n: number) => blogIndexPagePath(n)

  it('is hidden with a single page', () => {
    const { container } = render(<Pager page={1} total={1} hrefFor={hrefFor} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('first page: Newer unavailable, Older links to page 2, page 1 is current', () => {
    render(<Pager page={1} total={3} hrefFor={hrefFor} />)
    const nav = screen.getByRole('navigation', { name: 'Blog pages' })
    expect(within(nav).getByText('Newer').closest('[aria-disabled="true"]')).not.toBeNull()
    expect(within(nav).getByRole('link', { name: 'Older' })).toHaveAttribute('href', '/blog/page/2')
    expect(within(nav).getByRole('link', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('middle page: both ends are links', () => {
    render(<Pager page={2} total={3} hrefFor={hrefFor} />)
    expect(screen.getByRole('link', { name: 'Newer' })).toHaveAttribute('href', '/blog')
    expect(screen.getByRole('link', { name: 'Older' })).toHaveAttribute('href', '/blog/page/3')
    expect(screen.getByRole('link', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')
  })

  it('last page: Older unavailable; arrows mirror in RTL', () => {
    const { container } = render(<Pager page={3} total={3} hrefFor={hrefFor} />)
    expect(screen.getByText('Older').closest('[aria-disabled="true"]')).not.toBeNull()
    expect(screen.queryByRole('link', { name: 'Older' })).not.toBeInTheDocument()
    expect(container.querySelectorAll('svg.rtl\\:-scale-x-100')).toHaveLength(2)
  })
})

describe('routes and metadata', () => {
  it('/blog/page/1 is a 308 to /blog; out of range or malformed is a 404', async () => {
    await expect(resolveListingPage('1', 'en')).rejects.toThrow('NEXT_REDIRECT 308 /blog')
    await expect(resolveListingPage('1', 'es')).rejects.toThrow('NEXT_REDIRECT 308 /es/blog')
    await expect(resolveListingPage('99', 'en')).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(resolveListingPage('abc', 'en')).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(resolveListingPage('1', 'en', 'chrome')).rejects.toThrow('NEXT_REDIRECT 308 /blog/tags/chrome')
  })

  it('page 1 is self-canonical with the descriptive title, within 60 characters with the suffix', async () => {
    const meta = await listingMetadata(1)
    expect(meta.title).toBe(en.blog.metaTitle)
    expect(`${en.blog.metaTitle} | TabMerger`.length).toBeLessThanOrEqual(60)
    expect(meta.alternates?.canonical).toBe('/blog')
    expect((meta.openGraph as { title?: string }).title).toBe(`${en.blog.metaTitle} | TabMerger`)
  })

  it('later pages are self-canonical with "page N" in the title', async () => {
    const meta = await listingMetadata(2)
    expect(meta.title).toBe('Tab management guides, page 2')
    expect(meta.alternates?.canonical).toBe('/blog/page/2')
    const tagMeta = await listingMetadata(2, 'chrome')
    expect(tagMeta.alternates?.canonical).toBe('/blog/tags/chrome/page/2')
  })

  it('keeps "Blog" as the nav label and uses the new H1', () => {
    expect(en.nav.blog).toBe('Blog')
    expect(en.blog.indexTitle).toBe('Tab management guides')
  })
})

describe('sitemap', () => {
  it('lists /blog and, at 10 per page, a later index page only once there are more than 10 posts', async () => {
    const { default: sitemap } = await import('@/app/sitemap')
    const { indexableSlugs } = await import('@/lib/blog/posts')
    const paths = sitemap().map((entry) => new URL(entry.url).pathname)
    expect(paths).toContain('/blog')
    expect(paths.filter((p) => p.startsWith('/blog/page/'))).toEqual(laterPages(indexableSlugs().length, POSTS_PER_PAGE).map((n) => `/blog/page/${n}`))
  })
})
