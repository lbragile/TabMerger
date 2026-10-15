import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { SearchOverlay } from '@/components/Header/SearchOverlay'
import { SEARCH_ANNOUNCE_DELAY_MS } from '@/components/SearchAnnouncer'
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


const scrollSpy = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  Element.prototype.scrollIntoView = scrollSpy
})
afterEach(() => {
  vi.useRealTimers()
})

const combobox = () => screen.getByRole('combobox')

describe('SearchOverlay — combobox semantics', () => {
  it('the input is a combobox with a labelled listbox of options', () => {
    setup('docs')
    const input = combobox()
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('listbox', { name: 'Search results' })
    expect(input).toHaveAttribute('aria-controls', list.id)
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('aria-expanded is false and nothing is controlled when there are no options', () => {
    setup('zzzzqq')
    const input = combobox()
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).not.toHaveAttribute('aria-controls')
    expect(input).not.toHaveAttribute('aria-activedescendant')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('aria-activedescendant follows the arrow keys while the focus stays on the input', () => {
    setup('docs')
    const input = combobox()
    expect(input).not.toHaveAttribute('aria-activedescendant')
    const options = screen.getAllByRole('option')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id)
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // stops at the last
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id)
  })

  it('scrolls the option the cursor moved to into view, nearest edge', () => {
    setup('docs')
    expect(scrollSpy).not.toHaveBeenCalled()
    fireEvent.keyDown(combobox(), { key: 'ArrowDown' })
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }))
  })

  it('the example searches are options of a listbox too', () => {
    setup('')
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0)
  })
})

describe('SearchOverlay — result count region', () => {
  const count = () => screen.getByTestId('search-overlay-count')

  it('is a polite status region that stays empty for the examples (no query)', () => {
    setup('')
    expect(count()).toHaveAttribute('role', 'status')
    expect(count()).toHaveAttribute('aria-live', 'polite')
    act(() => void vi.advanceTimersByTime(1000))
    expect(count().textContent).toBe('')
  })

  it('says the number of results only after the typing delay', () => {
    setup('docs')
    expect(count().textContent).toBe('')
    act(() => void vi.advanceTimersByTime(SEARCH_ANNOUNCE_DELAY_MS))
    expect(count().textContent).toBe('2 results')
  })

  it('says "No results" when nothing matches', () => {
    setup('zzzzqq')
    act(() => void vi.advanceTimersByTime(SEARCH_ANNOUNCE_DELAY_MS))
    expect(count().textContent).toBe('No results')
  })
})
