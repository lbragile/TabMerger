/**
 * The blog listing's client side: sorting and title search (lib/blog/listing.ts), the Helpful
 * counts fetched once in the browser (loading placeholder, success, failure), and the listing
 * shell: URL state (`?sort=…&q=…&page=N` via history.replaceState), the sort menu's keyboard handling,
 * the "/" shortcut and Escape, the live result line, highlighted titles, the empty state, and the
 * unchanged static render when the URL has no params.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { HelpfulCount, HelpfulCountsProvider, toCounts } from '@/components/blog/HelpfulCounts'
import { ListingClient } from '@/components/blog/ListingClient'
import { SearchHighlight } from '@/components/blog/SearchHighlight'
import {
  DEFAULT_LISTING_QUERY,
  filterByTitle,
  isDefaultListing,
  listingQueryString,
  matchRanges,
  parseListingQuery,
  searchKey,
  sortEntries,
  type ListingEntry,
} from '@/lib/blog/listing'
import en from '@/messages/en'

const mock = vi.hoisted(() => ({
  configured: true,
  rpc: (() => Promise.resolve({ data: [], error: null })) as (name: string) => Promise<{ data: unknown; error: unknown }>,
  search: '',
}))

vi.mock('@/lib/supabase/client', () => ({
  get isSupabaseConfigured() {
    return mock.configured
  },
  createClient: () => ({ rpc: (name: string) => mock.rpc(name) }),
}))

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePathname: () => '/blog',
  useSearchParams: () => new URLSearchParams(mock.search),
}))

const messages = Object.fromEntries(Object.entries(en.blog).filter(([, value]) => typeof value === 'string')) as Record<string, string>

const ENTRIES: ListingEntry[] = [
  { slug: 'newest-long', title: 'Group tabs in Chrome', published: '2026-11-19', readMinutes: 9 },
  { slug: 'mid-short', title: 'Save every open tab', published: '2026-11-10', readMinutes: 3 },
  { slug: 'mid-short-b', title: 'Café tab tricks', published: '2026-11-10', readMinutes: 3 },
  { slug: 'oldest', title: 'Restore closed windows', published: '2026-10-01', readMinutes: 5 },
]
const slugs = (list: readonly ListingEntry[]) => list.map((entry) => entry.slug)

describe('sortEntries', () => {
  it('newest first, same-day posts by slug', () => {
    expect(slugs(sortEntries(ENTRIES, 'newest'))).toEqual(['newest-long', 'mid-short', 'mid-short-b', 'oldest'])
  })

  it('oldest first, a same-day tie still goes to the newest order', () => {
    expect(slugs(sortEntries(ENTRIES, 'oldest'))).toEqual(['oldest', 'mid-short', 'mid-short-b', 'newest-long'])
  })

  it('most helpful by count; missing counts are 0 and ties go to the newer post', () => {
    expect(slugs(sortEntries(ENTRIES, 'helpful', { oldest: 4, 'mid-short-b': 4 }))).toEqual(['mid-short-b', 'oldest', 'newest-long', 'mid-short'])
    expect(slugs(sortEntries(ENTRIES, 'helpful'))).toEqual(slugs(sortEntries(ENTRIES, 'newest')))
  })

  it('shortest read first, ties to the newer post', () => {
    expect(slugs(sortEntries(ENTRIES, 'shortest'))).toEqual(['mid-short', 'mid-short-b', 'oldest', 'newest-long'])
  })

  it('does not reorder its input', () => {
    const input = [...ENTRIES]
    sortEntries(input, 'oldest')
    expect(input).toEqual(ENTRIES)
  })
})

describe('filterByTitle', () => {
  it('ignores case and diacritics', () => {
    expect(slugs(filterByTitle(ENTRIES, 'CAFE'))).toEqual(['mid-short-b'])
    expect(slugs(filterByTitle(ENTRIES, 'café'))).toEqual(['mid-short-b'])
    expect(searchKey('Ünïcödé')).toBe('unicode')
  })

  it('matches anywhere in the title; an empty query keeps everything', () => {
    expect(slugs(filterByTitle(ENTRIES, 'tab'))).toEqual(['newest-long', 'mid-short', 'mid-short-b'])
    expect(filterByTitle(ENTRIES, '  ')).toHaveLength(ENTRIES.length)
  })

  it('returns nothing when no title matches', () => {
    expect(filterByTitle(ENTRIES, 'zzzz')).toEqual([])
  })
})

describe('listing query', () => {
  const parse = (qs: string) => parseListingQuery(new URLSearchParams(qs))

  it('round-trips through the URL, writing only the non-default parts', () => {
    const query = { sort: 'oldest', q: 'save tabs', page: 2 } as const
    expect(listingQueryString(query)).toBe('sort=oldest&q=save+tabs&page=2')
    expect(parse(listingQueryString(query))).toEqual(query)
    expect(listingQueryString(DEFAULT_LISTING_QUERY)).toBe('')
    expect(listingQueryString({ sort: 'newest', q: '', page: 3 })).toBe('')
    expect(isDefaultListing(parse(''))).toBe(true)
  })

  it('falls back to the default for unknown or malformed values', () => {
    expect(parse('sort=random&page=0')).toEqual(DEFAULT_LISTING_QUERY)
    expect(parse('page=01').page).toBe(1)
    expect(parse('page=-2').page).toBe(1)
    expect(parse('q=%20%20a%20%20b%20').q).toBe('a b')
    expect(parse(`q=${'x'.repeat(300)}`).q).toHaveLength(100)
  })
})

describe('toCounts', () => {
  it('accepts { slug, helpful } rows, numeric strings included', () => {
    expect(toCounts([{ slug: 'a', helpful: 3 }, { slug: 'b', helpful: '12' }])).toEqual({ a: 3, b: 12 })
    expect(toCounts([])).toEqual({})
  })

  it.each([[null], [{}], [[{ slug: 'a' }]], [[{ slug: 1, helpful: 1 }]], [[{ slug: 'a', helpful: -1 }]], [[{ slug: 'a', helpful: 1.5 }]]])(
    'rejects %j',
    (data) => {
      expect(toCounts(data)).toBeNull()
    }
  )
})

/** Resolves the pending RPC from inside the test. */
function deferredRpc() {
  let resolve!: (value: { data: unknown; error: unknown }) => void
  mock.rpc = () => new Promise((r) => (resolve = r))
  return (value: { data: unknown; error: unknown }) => act(async () => resolve(value))
}

function renderCount(slug = 'mid-short') {
  return render(
    <HelpfulCountsProvider locale="en" messages={messages}>
      <p data-testid="meta">
        Nov 10 · 3 min read
        <HelpfulCount slug={slug} />
      </p>
    </HelpfulCountsProvider>
  )
}

describe('Helpful counts', () => {
  beforeEach(() => {
    mock.configured = true
  })

  it('fetches every count in one call and shows a fixed-width placeholder meanwhile', async () => {
    const calls: string[] = []
    const answer = deferredRpc()
    const rpc = mock.rpc
    mock.rpc = (name) => (calls.push(name), rpc(name))
    renderCount()
    expect(screen.getByTestId('helpful-count-loading')).toHaveClass('w-9')
    expect(screen.queryByRole('img')).toBeNull()
    await answer({ data: [{ slug: 'mid-short', helpful: 12 }], error: null })
    expect(calls).toEqual(['blog_helpful_counts'])
    expect(screen.queryByTestId('helpful-count-loading')).toBeNull()
    expect(screen.getByRole('img', { name: '12 people found this helpful' })).toHaveTextContent('12')
  })

  it('shows 0 for a post nobody has marked, with the plural-aware name', async () => {
    const answer = deferredRpc()
    renderCount('oldest')
    await answer({ data: [{ slug: 'mid-short', helpful: 1 }], error: null })
    expect(screen.getByRole('img', { name: 'No one has marked this helpful yet' })).toHaveTextContent('0')
  })

  it.each([
    ['an RPC error (function missing)', { data: null, error: { code: 'PGRST202' } }],
    ['a malformed answer', { data: [{ slug: 'x' }], error: null }],
  ])('leaves the counts out on %s', async (_, value) => {
    const answer = deferredRpc()
    renderCount()
    await answer(value)
    expect(screen.queryByTestId('helpful-count-loading')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByTestId('meta')).toHaveTextContent(/^Nov 10 · 3 min read$/)
  })

  it('leaves the counts out when the request rejects', async () => {
    mock.rpc = () => Promise.reject(new Error('network'))
    renderCount()
    await act(async () => {})
    expect(screen.queryByTestId('helpful-count-loading')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('makes no request and shows no placeholder without Supabase configured', async () => {
    mock.configured = false
    const rpc = vi.fn()
    mock.rpc = rpc
    renderCount()
    await act(async () => {})
    expect(rpc).not.toHaveBeenCalled()
    expect(screen.queryByTestId('helpful-count-loading')).toBeNull()
  })
})

describe('matchRanges', () => {
  it('finds every match, ignoring case and accents, in original string positions', () => {
    expect(matchRanges('Tab groups and tabs', 'TAB')).toEqual([
      [0, 3],
      [15, 18],
    ])
    expect(matchRanges('Café tab tricks', 'cafe')).toEqual([[0, 4]])
    expect(matchRanges('Café tab', 'cafe')).toEqual([[0, 5]])
    expect(matchRanges('Save tabs', '  ')).toEqual([])
    expect(matchRanges('Save tabs', 'zz')).toEqual([])
  })
})

describe('ListingClient', () => {
  let replace: MockInstance<History['replaceState']>

  beforeEach(() => {
    mock.configured = true
    mock.rpc = () => Promise.resolve({ data: [{ slug: 'oldest', helpful: 7 }], error: null })
    mock.search = ''
    replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
  })

  afterEach(() => {
    replace.mockRestore()
  })

  const tree = () => (
    <HelpfulCountsProvider locale="en" messages={messages}>
      <ListingClient
        entries={ENTRIES}
        rows={Object.fromEntries(
          ENTRIES.map((entry) => [
            entry.slug,
            <article key={entry.slug}>
              <h3>
                <SearchHighlight text={entry.title} />
              </h3>
            </article>,
          ])
        )}
        featured={<div data-testid="featured" />}
        defaultList={<div data-testid="default-list" />}
        defaultPager={<div data-testid="default-pager" />}
        moreCount={3}
        emptyTopics={<ul data-testid="empty-topics" />}
        basePath="/blog"
        pageSize={2}
        locale="en"
      />
    </HelpfulCountsProvider>
  )
  async function renderListing() {
    const result = render(tree())
    await act(async () => {})
    return result
  }
  const titles = () => screen.queryAllByRole('article').map((article) => article.textContent)
  const heading = () => screen.getByRole('heading', { level: 2 })
  const searchbox = () => screen.getByRole('searchbox', { name: 'Search guides' })
  const sortButton = () => screen.getByRole('button', { name: /^Sort: / })

  it('with no params shows the static page unchanged under the "More guides" row', async () => {
    await renderListing()
    expect(screen.getByTestId('featured')).toBeInTheDocument()
    expect(screen.getByTestId('default-list')).toBeInTheDocument()
    expect(screen.getByTestId('default-pager')).toBeInTheDocument()
    expect(heading()).toHaveTextContent(/^More guides\s*3$/)
    expect(screen.getByRole('search')).toContainElement(searchbox())
    expect(searchbox()).toHaveAttribute('placeholder', 'Search guides by title')
    expect(searchbox()).toHaveAttribute('aria-keyshortcuts', '/')
    expect(sortButton()).toHaveAccessibleName('Sort: Newest')
    expect(screen.queryAllByRole('article')).toEqual([])
    expect(replace).not.toHaveBeenCalled()
  })

  describe('sort menu', () => {
    const listbox = () => screen.getByRole('listbox', { name: 'Sort by' })
    const activeOption = () => document.getElementById(listbox().getAttribute('aria-activedescendant')!)

    it('is a listbox button, collapsed until opened', async () => {
      await renderListing()
      expect(sortButton()).toHaveAttribute('aria-haspopup', 'listbox')
      expect(sortButton()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('listbox')).toBeNull()
    })

    it('arrow keys open it on the current sort; up/down, Home/End move; Enter picks and refocuses the button', async () => {
      await renderListing()
      sortButton().focus()
      fireEvent.keyDown(sortButton(), { key: 'ArrowDown' })
      expect(sortButton()).toHaveAttribute('aria-expanded', 'true')
      expect(sortButton()).toHaveAttribute('aria-controls', listbox().id)
      expect(listbox()).toHaveFocus()
      expect(activeOption()).toHaveTextContent('Newest')
      expect(activeOption()).toHaveAttribute('aria-selected', 'true')
      fireEvent.keyDown(listbox(), { key: 'ArrowUp' })
      expect(activeOption()).toHaveTextContent('Newest')
      fireEvent.keyDown(listbox(), { key: 'End' })
      expect(activeOption()).toHaveTextContent('Shortest read')
      fireEvent.keyDown(listbox(), { key: 'Home' })
      expect(activeOption()).toHaveTextContent('Newest')
      fireEvent.keyDown(listbox(), { key: 'ArrowDown' })
      expect(activeOption()).toHaveTextContent('Oldest')
      fireEvent.keyDown(listbox(), { key: 'Enter' })
      expect(replace).toHaveBeenCalledWith(null, '', '/blog?sort=oldest')
      expect(screen.queryByRole('listbox')).toBeNull()
      expect(sortButton()).toHaveFocus()
    })

    it('Space picks too; a letter jumps to the option starting with it', async () => {
      await renderListing()
      fireEvent.keyDown(sortButton(), { key: 'ArrowUp' })
      fireEvent.keyDown(listbox(), { key: 'm' })
      expect(activeOption()).toHaveTextContent('Most helpful')
      fireEvent.keyDown(listbox(), { key: ' ' })
      expect(replace).toHaveBeenCalledWith(null, '', '/blog?sort=helpful')
    })

    it('Escape closes it without a change and returns focus to the button', async () => {
      await renderListing()
      fireEvent.click(sortButton())
      expect(listbox()).toHaveFocus()
      fireEvent.keyDown(listbox(), { key: 'ArrowDown' })
      fireEvent.keyDown(listbox(), { key: 'Escape' })
      expect(screen.queryByRole('listbox')).toBeNull()
      expect(sortButton()).toHaveFocus()
      expect(replace).not.toHaveBeenCalled()
    })

    it('a click on an option picks it; a click outside closes it', async () => {
      await renderListing()
      fireEvent.click(sortButton())
      fireEvent.click(screen.getByRole('option', { name: 'Shortest read' }))
      expect(replace).toHaveBeenCalledWith(null, '', '/blog?sort=shortest')
      fireEvent.click(sortButton())
      fireEvent.pointerDown(document.body)
      expect(screen.queryByRole('listbox')).toBeNull()
    })

    it('checks the current sort, and the popover sits at the inline end (left in RTL)', async () => {
      mock.search = 'sort=helpful'
      await renderListing()
      expect(sortButton()).toHaveAccessibleName('Sort: Most helpful')
      fireEvent.click(sortButton())
      expect(screen.getByRole('option', { name: 'Most helpful' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('option', { name: 'Newest' })).toHaveAttribute('aria-selected', 'false')
      expect(listbox()).toHaveClass('end-0')
    })
  })

  describe('search field', () => {
    it('"/" from the page body focuses it and nothing is typed', async () => {
      await renderListing()
      expect(fireEvent.keyDown(document.body, { key: '/' })).toBe(false) // default prevented: no "/" typed
      expect(searchbox()).toHaveFocus()
      expect(searchbox()).toHaveValue('')
      expect(replace).not.toHaveBeenCalled()
    })

    it('"/" with Ctrl, Meta or Alt does nothing', async () => {
      await renderListing()
      for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
        expect(fireEvent.keyDown(document.body, { key: '/', [modifier]: true })).toBe(true)
      }
      expect(searchbox()).not.toHaveFocus()
    })

    it('"/" typed into another input, or into the field itself, is left alone', async () => {
      render(<input aria-label="Other field" />)
      await renderListing()
      const other = screen.getByRole('textbox', { name: 'Other field' })
      other.focus()
      expect(fireEvent.keyDown(other, { key: '/' })).toBe(true)
      expect(other).toHaveFocus()
      searchbox().focus()
      expect(fireEvent.keyDown(searchbox(), { key: '/' })).toBe(true)
    })

    it('"/" while the sort menu is open is left to the menu', async () => {
      await renderListing()
      fireEvent.click(sortButton())
      const listbox = screen.getByRole('listbox')
      expect(fireEvent.keyDown(listbox, { key: '/' })).toBe(true)
      expect(listbox).toHaveFocus()
    })

    it('the "/" hint is aria-hidden, gone while the field has focus and back on blur when empty', async () => {
      const { container } = await renderListing()
      const hint = () => container.querySelector('kbd')
      expect(hint()).toHaveAttribute('aria-hidden', 'true')
      expect(hint()).toHaveClass('hidden', 'sm:inline-block', '[@media(hover:none)_and_(pointer:coarse)]:hidden')
      fireEvent.focus(searchbox())
      expect(hint()).toBeNull()
      fireEvent.blur(searchbox())
      expect(hint()).toHaveTextContent('/')
      fireEvent.change(searchbox(), { target: { value: 'tab' } })
      expect(hint()).toBeNull()
    })

    it('shows the "/" hint when empty and a clear button once there is text', async () => {
      const { container } = await renderListing()
      expect(container.querySelector('kbd')).toHaveTextContent('/')
      expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
      fireEvent.change(searchbox(), { target: { value: 'tab' } })
      expect(container.querySelector('kbd')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
      expect(replace).toHaveBeenLastCalledWith(null, '', '/blog')
      expect(searchbox()).toHaveValue('')
      expect(searchbox()).toHaveFocus()
    })

    it('typing writes ?q= (collapsed); emptying it drops the params', async () => {
      await renderListing()
      fireEvent.change(searchbox(), { target: { value: '  save   tab ' } })
      expect(replace).toHaveBeenLastCalledWith(null, '', '/blog?q=save+tab')
      fireEvent.change(searchbox(), { target: { value: '' } })
      expect(replace).toHaveBeenLastCalledWith(null, '', '/blog')
    })

    it('keeps focus when the first letter switches the page into search mode', async () => {
      const { rerender } = await renderListing()
      searchbox().focus()
      fireEvent.change(searchbox(), { target: { value: 't' } })
      const field = searchbox()
      mock.search = 'q=t'
      rerender(tree())
      expect(searchbox()).toBe(field)
      expect(field).toHaveFocus()
    })

    it('Escape clears it, keeping the sort', async () => {
      mock.search = 'sort=shortest&q=tab'
      await renderListing()
      fireEvent.keyDown(searchbox(), { key: 'Escape' })
      expect(replace).toHaveBeenLastCalledWith(null, '', '/blog?sort=shortest')
      expect(searchbox()).toHaveValue('')
    })
  })

  it('while searching: the heading is the polite result line, with "Searching all N guides" and highlighted titles', async () => {
    mock.search = 'q=cafe'
    const { container } = await renderListing()
    expect(heading()).toHaveTextContent('1 guide matches “cafe”')
    expect(heading()).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText(/^Searching all 4 guides/)).toBeInTheDocument()
    expect(screen.queryByTestId('featured')).toBeNull()
    expect(titles()).toEqual(['Café tab tricks'])
    expect([...container.querySelectorAll('article mark')].map((mark) => mark.textContent)).toEqual(['Café'])
    expect(searchbox()).toHaveValue('cafe')
  })

  it('marks every match in each title', async () => {
    mock.search = 'q=tab'
    const { container } = await renderListing()
    expect(heading()).toHaveTextContent('3 guides match “tab”')
    expect([...container.querySelectorAll('article mark')].map((mark) => mark.textContent)).toEqual(['tab', 'tab'])
  })

  it('no match: the empty panel with a hint, topic links and Clear search', async () => {
    mock.search = 'q=zzzz'
    await renderListing()
    expect(heading()).toHaveTextContent('No guides match “zzzz”')
    expect(screen.getByText('Nothing with “zzzz” in the title yet.')).toBeInTheDocument()
    expect(screen.getByText('Try a shorter word, or browse a topic:')).toBeInTheDocument()
    expect(screen.getByTestId('empty-topics')).toBeInTheDocument()
    const clears = screen.getAllByRole('button', { name: 'Clear search' })
    fireEvent.click(clears[clears.length - 1])
    expect(replace).toHaveBeenLastCalledWith(null, '', '/blog')
    expect(searchbox()).toHaveValue('')
    expect(searchbox()).toHaveFocus()
  })

  it('under a non-default sort: no featured panel, every post in order, paged with the params', async () => {
    mock.search = 'sort=oldest'
    await renderListing()
    expect(screen.queryByTestId('featured')).toBeNull()
    expect(screen.queryByTestId('default-list')).toBeNull()
    expect(heading()).toHaveTextContent(/^More guides\s*4$/)
    expect(titles()).toEqual(['Restore closed windows', 'Save every open tab'])
    const pager = screen.getByRole('navigation', { name: 'Blog pages' })
    expect(within(pager).getByRole('link', { name: 'Older' })).toHaveAttribute('href', '/blog?sort=oldest&page=2')
  })

  it('most helpful uses the fetched counts', async () => {
    mock.search = 'sort=helpful'
    await renderListing()
    expect(titles()[0]).toBe('Restore closed windows')
  })

  it('clamps a page past the end to the last page', async () => {
    mock.search = 'q=tab&page=9'
    await renderListing()
    expect(titles()).toEqual(['Café tab tricks'])
  })
})
