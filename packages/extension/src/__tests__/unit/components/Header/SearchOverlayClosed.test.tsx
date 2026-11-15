import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { i18n } from '@/lib/i18n'
import { SearchOverlay } from '@/components/Header/SearchOverlay'
import { SEARCH_ANNOUNCE_DELAY_MS } from '@/components/SearchAnnouncer'
import type { GroupsState, Tab } from '@/lib/types'
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed'

/**
 * The search overlay's "Recently closed" section and the `closed:` scope (the overlay alone, with
 * the list passed in: SearchOverlayWithClosed.test.tsx covers reopening, the toast and Undo).
 */

const NOW = Date.now()

function groupsWith(tabs: Tab[]): GroupsState {
  return {
    active: { id: '', index: 0 },
    available: [
      {
        id: 'g1', name: 'Work', color: 'rgba(1,1,1,1)', updatedAt: 0, permanent: false, starred: false,
        windows: [{ id: 1, name: 'Main', starred: false, incognito: false, focused: false, tabs }],
      },
    ],
  }
}

const closedTab = (id: string, title: string, url = `https://${id}.test/page`, closedAt = NOW): RecentlyClosedEntry => ({ id, closedAt, kind: 'tab', tabs: [{ url, title }] })

function setup(query: string, opts: { entries?: readonly RecentlyClosedEntry[]; remember?: boolean; groupsState?: GroupsState; noSource?: boolean } = {}) {
  const onReopenClosed = vi.fn()
  const onClose = vi.fn()
  const onSelectTab = vi.fn()
  const onQueryChange = vi.fn()
  render(
    <SearchOverlay
      query={query}
      onQueryChange={onQueryChange}
      groupsState={opts.groupsState ?? groupsWith([{ id: 1, title: 'Stripe dashboard', url: 'https://dashboard.stripe.com' }])}
      onSelectGroup={vi.fn()}
      onSelectWindow={vi.fn()}
      onSelectTab={onSelectTab}
      onClose={onClose}
      inputRef={createRef<HTMLInputElement>()}
      {...(opts.noSource ? {} : { closed: { entries: opts.entries ?? [], remember: opts.remember ?? true }, onReopenClosed })}
    />
  )
  return { onReopenClosed, onClose, onSelectTab, onQueryChange }
}

const closedSection = () => screen.queryByTestId('search-closed-section')
const closedRows = () => screen.queryAllByTestId('search-closed-result')
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, ...init })

afterEach(() => {
  document.documentElement.dir = ''
})

describe('SearchOverlay — Recently closed section', () => {
  it('comes after the saved results, as its own labelled group of options in the same listbox', () => {
    setup('stripe', { entries: [closedTab('c1', 'Stripe invoices')] })
    const listbox = screen.getByRole('listbox', { name: 'Search results' })
    const options = within(listbox).getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('Stripe dashboard')
    expect(options[1]).toHaveTextContent('Stripe invoices')
    const group = within(listbox).getByRole('group', { name: 'Recently closed' })
    expect(within(group).getAllByRole('option')).toHaveLength(1)
    expect(options[1]).toHaveTextContent('closed today')
  })

  it('shows at most 3, best match first, and never changes the saved results (12-result cap kept)', () => {
    const saved = Array.from({ length: 14 }, (_, i): Tab => ({ id: i + 1, title: `Docs saved ${i}`, url: `https://s${i}.test` }))
    const entries = [
      closedTab('anywhere', 'Bigdocs'),
      closedTab('prefix', 'Docs closed prefix'),
      closedTab('exact', 'docs'),
      closedTab('word', 'Read docs here'),
    ]
    setup('docs', { entries, groupsState: groupsWith(saved) })
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(15)
    options.slice(0, 12).forEach((o, i) => expect(o).toHaveTextContent(`Docs saved ${i}`))
    expect(closedRows().map((r) => r.textContent)).toEqual([
      expect.stringContaining('docs'),
      expect.stringContaining('Docs closed prefix'),
      expect.stringContaining('Read docs here'),
    ])
  })

  it('lists the closed matches even when no saved tab matches', () => {
    setup('invoices', { entries: [closedTab('c1', 'Stripe invoices')] })
    expect(closedRows()).toHaveLength(1)
    expect(screen.queryByText(/No matches/)).not.toBeInTheDocument()
  })

  it('marks the match in the title, or in the address when only the address matched', () => {
    setup('invoices', { entries: [closedTab('t', 'Stripe invoices'), closedTab('u', 'Billing', 'https://pay.test/invoices/42')] })
    const [byTitle, byUrl] = closedRows()
    expect(byTitle.querySelector('mark')?.textContent).toBe('invoices')
    expect(byUrl.querySelector('mark')?.textContent).toBe('invoices')
    expect(byUrl).toHaveTextContent('pay.test/invoices/42')
  })

  it('a match inside a closed window shows that tab and says it came from a closed window', () => {
    const w: RecentlyClosedEntry = { id: 'w', closedAt: NOW, kind: 'window', tabs: [{ url: 'https://a.test', title: 'Mail' }, { url: 'https://b.test', title: 'Invoices' }] }
    const { onReopenClosed, onClose } = setup('invoices', { entries: [w] })
    const [row] = closedRows()
    expect(row).toHaveTextContent('Invoices')
    expect(row).toHaveTextContent('from a closed window')
    fireEvent.click(row)
    expect(onReopenClosed).toHaveBeenCalledWith(expect.objectContaining({ entry: w, tabIndex: 1 }), { background: false })
    expect(onClose).toHaveBeenCalled()
  })

  it('the clock icon is hidden from screen readers', () => {
    setup('invoices', { entries: [closedTab('c1', 'Stripe invoices')] })
    closedRows()[0].querySelectorAll('svg').forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'))
  })

  it('does not appear with remembering off, with no entries, with a group:/window: filter, or without a source', () => {
    const entries = [closedTab('c1', 'Stripe invoices')]
    for (const [q, opts] of [
      ['stripe', { entries, remember: false }],
      ['stripe', { entries: [] }],
      ['group:Work stripe', { entries }],
      ['window:Main stripe', { entries }],
      ['stripe', { entries, noSource: true }],
    ] as const) {
      setup(q, opts)
      expect(closedSection(), `${q} ${JSON.stringify(opts)}`).not.toBeInTheDocument()
      cleanup()
    }
  })

  it('Enter on a closed row reopens it and closes the overlay; Ctrl/Cmd+Enter opens it in the background', () => {
    const entry = closedTab('c1', 'Stripe invoices')
    const { onReopenClosed, onClose, onSelectTab } = setup('stripe', { entries: [entry] })
    press('ArrowDown')
    press('ArrowDown')
    expect(closedRows()[0]).toHaveAttribute('aria-selected', 'true')
    press('Enter')
    expect(onSelectTab).not.toHaveBeenCalled()
    expect(onReopenClosed).toHaveBeenCalledWith(expect.objectContaining({ entry, tabIndex: 0 }), { background: false })
    expect(onClose).toHaveBeenCalledTimes(1)
    press('Enter', { ctrlKey: true })
    expect(onReopenClosed).toHaveBeenLastCalledWith(expect.objectContaining({ entry }), { background: true })
  })

  it('Enter on a saved result still picks the saved tab', () => {
    const { onReopenClosed, onSelectTab } = setup('stripe', { entries: [closedTab('c1', 'Stripe invoices')] })
    press('ArrowDown')
    press('Enter')
    expect(onSelectTab).toHaveBeenCalledWith(0, 0, 0)
    expect(onReopenClosed).not.toHaveBeenCalled()
  })

  it('Ctrl/Cmd or middle click opens in the background', () => {
    const { onReopenClosed } = setup('stripe', { entries: [closedTab('c1', 'Stripe invoices')] })
    fireEvent.click(closedRows()[0], { metaKey: true })
    expect(onReopenClosed).toHaveBeenLastCalledWith(expect.anything(), { background: true })
    fireEvent(closedRows()[0], new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(onReopenClosed).toHaveBeenCalledTimes(2)
    expect(onReopenClosed).toHaveBeenLastCalledWith(expect.anything(), { background: true })
  })

  it('renders right to left: rows keep the existing logical layout and the address stays left to right', () => {
    document.documentElement.dir = 'rtl'
    setup('invoices', { entries: [closedTab('u', 'Billing', 'https://pay.test/invoices/42')] })
    const row = closedRows()[0]
    expect(row.className).toContain('text-start')
    expect(row.querySelector('[dir="ltr"]')).toHaveTextContent('pay.test/invoices/42')
    expect(row.querySelector('[dir="auto"]')).toHaveTextContent('Billing')
  })
})

describe('SearchOverlay — closed: scope', () => {
  it('alone lists only closed entries, newest first, up to the 12-result cap', () => {
    const entries = Array.from({ length: 14 }, (_, i) => closedTab(`c${i}`, `Closed ${i}`, undefined, NOW - i * 1000))
    setup('closed:', { entries })
    expect(screen.queryByText('Stripe dashboard')).not.toBeInTheDocument()
    expect(closedRows()).toHaveLength(12)
    expect(closedRows()[0]).toHaveTextContent('Closed 0')
  })

  it('with words searches only the closed entries', () => {
    setup('closed: stripe', { entries: [closedTab('c1', 'Stripe invoices'), closedTab('c2', 'Mail')] })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(closedRows()[0]).toHaveTextContent('Stripe invoices')
  })

  it('lists a closed window as a whole window; Enter restores it', () => {
    const w: RecentlyClosedEntry = { id: 'w', closedAt: NOW, kind: 'window', tabs: [{ url: 'https://a.test', title: 'A' }, { url: 'https://b.test', title: 'B' }] }
    const { onReopenClosed } = setup('closed:', { entries: [w] })
    expect(closedRows()[0]).toHaveTextContent('Window · 2 tabs')
    press('ArrowDown')
    press('Enter')
    expect(onReopenClosed).toHaveBeenCalledWith(expect.objectContaining({ entry: w, tabIndex: undefined }), { background: false })
  })

  it('with nothing closed shows the usual no-matches text', () => {
    setup('closed: zzz', { entries: [closedTab('c1', 'Mail')] })
    expect(screen.getByTestId('search-no-matches')).toHaveTextContent('No matches for "closed: zzz"')
  })

  it('with remembering off says so', () => {
    setup('closed:', { entries: [closedTab('c1', 'Mail')], remember: false })
    expect(screen.getByTestId('search-no-matches')).toHaveTextContent('Remembering closed tabs is off')
  })

  it('is in the examples list, and picking it fills the search', () => {
    const { onQueryChange } = setup('')
    const example = screen.getByRole('option', { name: /closed:/ })
    expect(example).toHaveTextContent('Search only tabs you closed recently')
    fireEvent.click(example)
    expect(onQueryChange).toHaveBeenCalledWith('closed:')
  })

  it('does not open a picker (it takes free text)', () => {
    setup('closed:str', { entries: [closedTab('c1', 'Stripe')] })
    expect(screen.queryByText(/^Pick a/)).not.toBeInTheDocument()
    expect(closedRows()).toHaveLength(1)
  })
})

describe('SearchOverlay — live count includes closed matches', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('counts saved and closed results together', () => {
    setup('stripe', { entries: [closedTab('c1', 'Stripe invoices'), closedTab('c2', 'Stripe docs')] })
    act(() => void vi.advanceTimersByTime(SEARCH_ANNOUNCE_DELAY_MS))
    expect(screen.getByTestId('search-overlay-count').textContent).toBe('3 results')
  })
})

describe('SearchOverlay — Recently closed in another language', () => {
  afterEach(async () => {
    await act(async () => { await i18n.changeLanguage('en') })
  })

  it('uses the Hebrew heading and wording', async () => {
    await act(async () => { await i18n.changeLanguage('he') })
    document.documentElement.dir = 'rtl'
    setup('invoices', { entries: [closedTab('c1', 'Stripe invoices')] })
    expect(screen.getByRole('group', { name: 'נסגרו לאחרונה' })).toBeInTheDocument()
    expect(closedRows()[0]).toHaveTextContent('נסגרה היום')
  })
})
