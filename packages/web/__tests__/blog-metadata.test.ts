/**
 * A post's social metadata: the designed PNG card for Open Graph and X (sizes, type, alt), an
 * article with its dates and tags, the canonical as og:url, and the card first in the BlogPosting
 * images.
 */
import { describe, expect, it } from 'vitest'
import { blogPostingJsonLd } from '@/lib/blog/jsonLd'
import { blogPostMetadata } from '@/lib/blog/metadata'
import type { LoadedPost, Post } from '@/lib/blog/posts'

const post = {
  slug: 'save-all-open-tabs',
  title: 'How to save all open tabs and get them back later',
  seoTitle: 'How to Save All Open Tabs (Chrome, Edge, Firefox)',
  description: 'Save every open tab.',
  published: '2026-11-19',
  updated: '2026-11-19',
  images: [{ src: '/blog/save-all-open-tabs/chrome-bookmarks-folder.webp', alt: 'Bookmarks' }],
  ogImage: { src: '/blog/save-all-open-tabs/og.png', alt: 'The guide card' },
  sources: [],
  tags: ['tab-management', 'save-tabs', 'chrome'],
} as unknown as Post

const loaded = { post, Content: () => null, contentLocale: 'en', readMinutes: 4, locales: ['en'] } as unknown as LoadedPost

describe('blog post metadata', () => {
  it('describes the share card for Open Graph and X', async () => {
    const meta = await blogPostMetadata(loaded, 'en', ['tab management', 'save tabs', 'chrome'])
    const og = meta.openGraph as Record<string, unknown> & { images: Record<string, unknown>[] }
    expect(og.type).toBe('article')
    expect(og.url).toBe('/blog/save-all-open-tabs')
    expect(og.siteName).toBe('TabMerger')
    expect(og.publishedTime).toBe('2026-11-19')
    expect(og.tags).toEqual(['tab management', 'save tabs', 'chrome'])
    expect(og.images).toEqual([{ url: '/blog/save-all-open-tabs/og.png', width: 1200, height: 630, type: 'image/png', alt: 'The guide card' }])
    const twitter = meta.twitter as Record<string, unknown> & { images: Record<string, unknown>[] }
    expect(twitter.card).toBe('summary_large_image')
    expect(twitter.images[0]).toMatchObject({ url: '/blog/save-all-open-tabs/og.png', alt: 'The guide card' })
    expect(meta.alternates?.canonical).toBe('/blog/save-all-open-tabs')
  })

  it('lists the card first in the BlogPosting images, as absolute URLs', () => {
    const data = blogPostingJsonLd(post, '/blog/save-all-open-tabs', 'en', ['tab management'], new URL('https://tabmerger.com'))
    expect(data.image[0]).toBe('https://tabmerger.com/blog/save-all-open-tabs/og.png')
    expect(data.image.every((src: string) => src.startsWith('https://tabmerger.com/'))).toBe(true)
    expect(data.keywords).toBe('tab management')
  })
})
