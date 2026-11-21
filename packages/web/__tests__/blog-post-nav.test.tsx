/**
 * "More posts" at the end of a post: a link per neighbouring live post (older = Previous, newer =
 * Next), nothing at all without one; scheduled posts never appear; titles in the page's language
 * with English fallback (or the post's `navTitle`); full titles in the accessible names, cut to
 * one line visually; arrows mirrored in RTL.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PostNav } from '@/components/blog/PostNav'
import { adjacentPosts } from '@/lib/blog/posts'

const source = (title: string, published: string, navTitle?: string) => ({
  words: 100,
  title,
  description: '',
  published,
  images: [],
  tags: [],
  ...(navTitle ? { navTitle } : {}),
  load: async () => ({}),
})
const LONG = 'A deliberately long title that keeps going so the link has to shorten it with an ellipsis'
const sources = {
  first: { en: source('First post', '2026-11-19'), es: source('Primera', '2026-11-19') },
  second: { en: source(LONG, '2026-11-21') },
  third: { en: source('Third post', '2026-11-23', 'Third') },
  scheduled: { en: source('Tomorrow', '2026-11-25') },
}
const now = new Date('2026-11-24T12:00:00Z')

function renderNav(slug: string, at: Date = now) {
  return render(<PostNav {...adjacentPosts(slug, 'en', at, sources)} />)
}

describe('adjacentPosts', () => {
  it('orders live posts by published date: older is previous, newer is next', () => {
    expect(adjacentPosts('second', 'en', now, sources)).toEqual({
      older: { slug: 'first', title: 'First post' },
      newer: { slug: 'third', title: 'Third' },
    })
  })

  it('never offers a scheduled post', () => {
    expect(adjacentPosts('third', 'en', now, sources).newer).toBeUndefined()
  })

  it('uses the page locale title, else English, and a navTitle when the post has one', () => {
    expect(adjacentPosts('second', 'es', now, sources).older?.title).toBe('Primera')
    expect(adjacentPosts('first', 'es', now, sources).newer?.title).toBe(LONG)
    expect(adjacentPosts('second', 'en', now, sources).newer?.title).toBe('Third')
  })
})

describe('PostNav', () => {
  it('renders nothing (no landmark) when there is no neighbour', () => {
    const { container } = renderNav('first', new Date('2026-11-20T00:00:00Z'))
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('oldest post: only Next, at the end', () => {
    renderNav('first', new Date('2026-11-22T00:00:00Z'))
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName(`Next post: ${LONG}`)
    expect(links[0]).toHaveAttribute('href', '/blog/second')
    expect(links[0].className).toContain('col-start-2')
  })

  it('newest live post: only Previous', () => {
    renderNav('third')
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName(`Previous post: ${LONG}`)
    expect(screen.queryByText('Tomorrow')).not.toBeInTheDocument()
  })

  it('middle post: both, with full titles in the names and tooltips, cut to one line visually', () => {
    renderNav('second')
    expect(screen.getByRole('navigation', { name: 'More posts' })).toBeInTheDocument()
    const previous = screen.getByRole('link', { name: 'Previous post: First post' })
    const next = screen.getByRole('link', { name: 'Next post: Third' })
    expect(previous).toHaveAttribute('title', 'Previous post: First post')
    expect(next).toHaveAttribute('href', '/blog/third')
    for (const link of [previous, next]) expect(link.querySelector('.truncate')).not.toBeNull()
  })

  it('mirrors the arrows in right-to-left pages', () => {
    const { container } = renderNav('second')
    expect(container.querySelectorAll('svg.rtl\\:-scale-x-100')).toHaveLength(2)
  })
})
