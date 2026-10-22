import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { SearchOverlay } from '@/components/Header/SearchOverlay'
import type { GroupsState } from '@/lib/types'

function makeGroupsState(): GroupsState {
  return {
    active: { id: '', index: 0 },
    available: [
      {
        id: 'g1', name: 'Work', color: 'rgba(1,1,1,1)', updatedAt: 0, permanent: false, starred: false,
        windows: [
          {
            id: 1, name: 'Main', starred: false, incognito: false, focused: false,
            tabs: [
              { id: 1, title: 'React docs', url: 'https://react.dev', chromeGroup: { id: 0, name: 'Dev', color: 'blue' } },
              { id: 2, title: 'Vue docs', url: 'https://vuejs.org' },
            ],
          },
        ],
      },
      {
        id: 'g2', name: 'Personal', color: 'rgba(2,2,2,1)', updatedAt: 0, permanent: false, starred: false,
        windows: [
          { id: 2, name: 'Shopping', starred: false, incognito: false, focused: false, tabs: [] },
        ],
      },
    ],
  }
}

function setup(query: string, overrides: Partial<{ onQueryChange: (q: string) => void; onSelectGroup: (i: number) => void; onSelectWindow: (g: number, w: number) => void; onClose: () => void; groupsState: GroupsState | undefined }> = {}) {
  const inputRef = createRef<HTMLInputElement>()
  const onQueryChange = overrides.onQueryChange ?? vi.fn()
  const onSelectGroup = overrides.onSelectGroup ?? vi.fn()
  const onSelectWindow = overrides.onSelectWindow ?? vi.fn()
  const onClose = overrides.onClose ?? vi.fn()
  const groupsState = 'groupsState' in overrides ? overrides.groupsState : makeGroupsState()

  render(
    <SearchOverlay
      query={query}
      onQueryChange={onQueryChange}
      groupsState={groupsState}
      onSelectGroup={onSelectGroup}
      onSelectWindow={onSelectWindow}
      onClose={onClose}
      inputRef={inputRef}
    />
  )
  return { onQueryChange, onSelectGroup, onSelectWindow, onClose }
}

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * Finds a row by its full text even when a search match splits it into <mark> pieces
 * (getByText only looks at one text node per element). Returns the innermost element.
 */
const textOf = (text: string) =>
  screen.getByText((_content, el) => !!el && el.textContent === text && !Array.from(el.children).some((c) => c.textContent === text))
const queryTextOf = (text: string) =>
  screen.queryByText((_content, el) => !!el && el.textContent === text && !Array.from(el.children).some((c) => c.textContent === text))

describe('SearchOverlay — empty state', () => {
  it('shows example searches when query is empty', () => {
    setup('')
    expect(screen.getByText('Try these searches')).toBeTruthy()
    expect(screen.getByText('react')).toBeTruthy()
    expect(screen.getByText('group:')).toBeTruthy()
  })

  it('clicking an example fills the query and refocuses input', () => {
    const { onQueryChange } = setup('')
    fireEvent.click(screen.getByText('react'))
    expect(onQueryChange).toHaveBeenCalledWith('react')
  })
})

describe('SearchOverlay — results mode', () => {
  it('shows matching tabs for a plain text query', () => {
    setup('react')
    expect(textOf('React docs')).toBeTruthy()
    expect(queryTextOf('Vue docs')).toBeNull()
  })

  it('shows "No matches" when query matches nothing', () => {
    setup('zzz-nonexistent')
    expect(screen.getByText(/No matches for/)).toBeTruthy()
  })

  it('shows a group\'s windows when scoped with a quoted group: filter', () => {
    setup('group:"Work" ')
    expect(screen.getByText('Main')).toBeTruthy()
  })

  it('clicking a tab result calls onSelectGroup with its group index', () => {
    const { onSelectGroup } = setup('react')
    fireEvent.click(textOf('React docs'))
    expect(onSelectGroup).toHaveBeenCalledWith(0)
  })

  it('renders nothing useful when groupsState is undefined', () => {
    setup('react', { groupsState: undefined })
    expect(screen.getByText(/No matches for/)).toBeTruthy()
  })

  it('matches only the text as typed: letters out of sequence find nothing', () => {
    setup('rct')
    expect(screen.getByText(/No matches for/)).toBeTruthy()
    expect(queryTextOf('React docs')).toBeNull()
  })

  it('orders results exact, then prefix, then word start, then anywhere, stable within a rank', () => {
    const tab = (id: number, title: string) => ({ id, title, url: `https://example.com/${id}` })
    const groupsState: GroupsState = {
      active: { id: '', index: 0 },
      available: [{
        id: 'g1', name: 'Work', color: 'rgba(1,1,1,1)', updatedAt: 0, permanent: false, starred: false,
        windows: [{
          id: 1, name: 'Main', starred: false, incognito: false, focused: false,
          tabs: [tab(1, 'Ninjira notes'), tab(2, 'Open Jira'), tab(3, 'Jira board'), tab(4, 'jira'), tab(5, 'Jira sprint'), tab(6, 'Jra only')],
        }],
      }],
    }
    setup('jira', { groupsState })
    const rows = screen.getAllByRole('option').map((o) => o.textContent ?? '')
    const order = ['jira', 'Jira board', 'Jira sprint', 'Open Jira', 'Ninjira notes'].map((t) => rows.findIndex((r) => r.startsWith(`Work${t}`) || r.startsWith(t)))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(rows.some((r) => r.includes('Jra only'))).toBe(false)
  })
})

describe('SearchOverlay — group: picker', () => {
  it('shows group picks when query ends with bare "group:"', () => {
    setup('group:')
    expect(screen.getByText('Pick a group')).toBeTruthy()
    expect(textOf('Work')).toBeTruthy()
    expect(textOf('Personal')).toBeTruthy()
  })

  it('filters group picks by typed text', () => {
    setup('group:pers')
    expect(textOf('Personal')).toBeTruthy()
    expect(queryTextOf('Work')).toBeNull()
  })

  it('does not pick a group by letters out of sequence', () => {
    setup('group:wrk')
    expect(queryTextOf('Work')).toBeNull()
  })

  it('lists picks best match first', () => {
    const g = (id: string, name: string) => ({ id, name, color: 'rgba(1,1,1,1)', updatedAt: 0, permanent: false, starred: false, windows: [] })
    setup('group:ops', { groupsState: { active: { id: '', index: 0 }, available: [g('a', 'DevOps'), g('b', 'Ops'), g('c', 'Ops team'), g('d', 'Big Ops')] } })
    const rows = screen.getAllByRole('option').map((o) => o.textContent)
    expect(rows).toEqual(['Ops', 'Ops team', 'Big Ops', 'DevOps'])
  })

  it('shows "No matches" in picker when nothing matches', () => {
    setup('group:zzz')
    expect(screen.getByText('No matches')).toBeTruthy()
  })

  it('clicking a group pick schedules a quoted query update', async () => {
    vi.useFakeTimers()
    const { onQueryChange } = setup('group:wor')
    fireEvent.click(textOf('Work'))
    vi.runAllTimers()
    expect(onQueryChange).toHaveBeenCalledWith('group:"Work" ')
    vi.useRealTimers()
  })

  it('ArrowDown + Enter completes the highlighted picker item via completePick', () => {
    // Regression guard for the keydown-effect's `completePick` dependency: this is the
    // ONLY path (keyboard, not click) that exercises the effect closure directly, so a
    // stale closure here would surface as `onQueryChange` never firing.
    vi.useFakeTimers()
    const { onQueryChange } = setup('group:wor')
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    vi.runAllTimers()
    expect(onQueryChange).toHaveBeenCalledWith('group:"Work" ')
    vi.useRealTimers()
  })
})

describe('SearchOverlay — window: picker', () => {
  it('shows window picks for bare "window:"', () => {
    setup('window:')
    expect(screen.getByText('Pick a window')).toBeTruthy()
    expect(screen.getByText('Main')).toBeTruthy()
    expect(screen.getByText('Shopping')).toBeTruthy()
  })
})

describe('SearchOverlay — tag: picker', () => {
  it('shows tag picks for bare "tag:"', () => {
    setup('tag:')
    expect(screen.getByText('Pick a tag')).toBeTruthy()
    expect(screen.getByText('Dev')).toBeTruthy()
  })
})

describe('SearchOverlay — keyboard navigation', () => {
  it('ArrowDown moves cursor and Enter selects the example', () => {
    const { onQueryChange } = setup('')
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onQueryChange).toHaveBeenCalledWith('react')
  })

  it('ArrowUp does not go below index 0', () => {
    setup('')
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    fireEvent.keyDown(window, { key: 'Enter' })
    // cursor floors at 0 -> selects first example without throwing
    expect(screen.getByText('Try these searches')).toBeTruthy()
  })
})

describe('SearchOverlay — closing', () => {
  it('clicking the backdrop calls onClose', () => {
    const { onClose } = setup('')
    const backdrop = document.querySelector('.fixed.inset-0.z-40') as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('SearchOverlay — text direction', () => {
  it('the search box takes the direction of what is typed', () => {
    setup('react')
    expect(screen.getByRole('combobox').getAttribute('dir')).toBe('auto')
  })

  it('an empty search box follows the UI direction, so its placeholder is not laid out backwards', () => {
    // Chromium treats an empty dir="auto" field as left to right
    setup('')
    expect(screen.getByRole('combobox').hasAttribute('dir')).toBe(false)
  })

  it('a tab title result keeps its own direction (dir="auto")', () => {
    setup('react')
    const row = textOf('React docs')
    expect(row.closest('[dir]')?.getAttribute('dir')).toBe('auto')
  })

  it('a tab found by its address shows that piece of the URL left to right', () => {
    setup('vuejs')
    const meta = screen.getAllByText((_c, el) => !!el && el.getAttribute('dir') === 'ltr' && (el.textContent ?? '').includes('vuejs'))
    expect(meta.length).toBeGreaterThan(0)
  })
})
