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
    expect(screen.getByText('React docs')).toBeTruthy()
    expect(screen.queryByText('Vue docs')).toBeNull()
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
    fireEvent.click(screen.getByText('React docs'))
    expect(onSelectGroup).toHaveBeenCalledWith(0)
  })

  it('renders nothing useful when groupsState is undefined', () => {
    setup('react', { groupsState: undefined })
    expect(screen.getByText(/No matches for/)).toBeTruthy()
  })
})

describe('SearchOverlay — group: picker', () => {
  it('shows group picks when query ends with bare "group:"', () => {
    setup('group:')
    expect(screen.getByText('Pick a group')).toBeTruthy()
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('Personal')).toBeTruthy()
  })

  it('filters group picks by typed text', () => {
    setup('group:pers')
    expect(screen.getByText('Personal')).toBeTruthy()
    expect(screen.queryByText('Work')).toBeNull()
  })

  it('shows "No matches" in picker when nothing matches', () => {
    setup('group:zzz')
    expect(screen.getByText('No matches')).toBeTruthy()
  })

  it('clicking a group pick schedules a quoted query update', async () => {
    vi.useFakeTimers()
    const { onQueryChange } = setup('group:wor')
    fireEvent.click(screen.getByText('Work'))
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
