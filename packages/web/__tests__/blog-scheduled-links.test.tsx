/**
 * Links between posts when the target is scheduled: a post may link to a post whose `published`
 * date is still ahead. That page is a 404 on production until the date, so `PostLink` shows the
 * link's words as plain text there, and a real link on preview and local development (where the
 * page exists with its "Scheduled" banner). Over a fixture index, so no real post is named.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const state = vi.hoisted(() => ({ production: false }))

vi.mock('@/lib/deployment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/deployment')>()),
  isProductionDeployment: () => state.production,
}))

vi.mock('@/generated/blog', () => {
  const file = (published: string) => ({
    words: 400,
    title: 'T',
    description: 'D',
    published,
    images: [],
    tags: [],
    load: async () => ({ default: () => null, post: {} }),
  })
  return {
    BLOG_SOURCES: { 'live-post': { en: file('2020-01-01') }, 'future-post': { en: file('2099-01-01') } },
    BLOG_BOXES: {},
  }
})

import { PostLink } from '@/components/blog/PostBody'
import { isScheduledPostLink } from '@/lib/blog/posts'

afterEach(() => {
  state.production = false
})

describe('isScheduledPostLink', () => {
  const sources = { soon: { en: { published: '2026-11-25' } }, live: { en: { published: '2026-11-19' } } }
  const NOW = new Date('2026-11-20T12:00:00Z')

  it('is true for a known post before its date, with or without an anchor or query', () => {
    expect(isScheduledPostLink('/blog/soon', NOW, sources)).toBe(true)
    expect(isScheduledPostLink('/blog/soon/', NOW, sources)).toBe(true)
    expect(isScheduledPostLink('/blog/soon#faq', NOW, sources)).toBe(true)
    expect(isScheduledPostLink('/blog/soon?ref=x', NOW, sources)).toBe(true)
  })

  it('turns false at 00:00 UTC on the publication date', () => {
    expect(isScheduledPostLink('/blog/soon', new Date('2026-11-24T23:59:59Z'), sources)).toBe(true)
    expect(isScheduledPostLink('/blog/soon', new Date('2026-11-25T00:00:00Z'), sources)).toBe(false)
  })

  it('is false for live posts, unknown slugs and anything that is not a post path', () => {
    expect(isScheduledPostLink('/blog/live', NOW, sources)).toBe(false)
    expect(isScheduledPostLink('/blog/no-such-post', NOW, sources)).toBe(false)
    expect(isScheduledPostLink('/blog/constructor', NOW, sources)).toBe(false)
    expect(isScheduledPostLink('/blog', NOW, sources)).toBe(false)
    expect(isScheduledPostLink('/blog/tags/soon', NOW, sources)).toBe(false)
    expect(isScheduledPostLink('/features', NOW, sources)).toBe(false)
    expect(isScheduledPostLink('https://example.com/blog/soon', NOW, sources)).toBe(false)
  })
})

describe('PostLink to a scheduled post', () => {
  it('is plain text on production, with no copy button', () => {
    state.production = true
    render(
      <p>
        See <PostLink href="/blog/future-post">the next guide</PostLink>.
      </p>
    )
    expect(screen.getByText(/the next guide/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is a link on preview and local development', () => {
    render(<PostLink href="/blog/future-post">the next guide</PostLink>)
    expect(screen.getByRole('link', { name: 'the next guide' })).toHaveAttribute('href', '/blog/future-post')
  })

  it('links a live post on production, and keeps an anchor on a scheduled one off', () => {
    state.production = true
    render(
      <>
        <PostLink href="/blog/live-post">the old guide</PostLink>
        <PostLink href="/blog/future-post#faq">its FAQ</PostLink>
      </>
    )
    expect(screen.getByRole('link', { name: 'the old guide' })).toHaveAttribute('href', '/blog/live-post')
    expect(screen.queryByRole('link', { name: 'its FAQ' })).toBeNull()
  })
})
