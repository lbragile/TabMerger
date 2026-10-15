import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { SearchAnnouncer, SEARCH_ANNOUNCE_DELAY_MS } from '@/components/SearchAnnouncer'
import { useUIStore } from '@/stores/uiStore'
import { setTourSearchShowsDemo } from '@/lib/tourSandbox'
import type { Group } from '@/lib/types'

const tab = (title: string) => ({ id: 0, title, url: `https://example.com/${title}` })
const group = (id: string, titles: string[], extra: Partial<Group> = {}): Group => ({
  id,
  name: id,
  color: 'rgba(0,0,0,1)',
  updatedAt: 0,
  windows: [{ id: 1, tabs: titles.map(tab), incognito: false, focused: false }],
  ...extra,
})
const groups = [group('work', ['alpha one', 'alpha two']), group('play', ['alpha three', 'beta']), group('other', ['gamma'])]
const say = () => screen.getByTestId('search-announcer').textContent
const search = (text: string) => act(() => useUIStore.getState().setSearchFilter(text))
const wait = (ms = SEARCH_ANNOUNCE_DELAY_MS) => act(() => void vi.advanceTimersByTime(ms))

beforeEach(() => {
  vi.useFakeTimers()
  useUIStore.setState({ searchFilter: '' })
})
afterEach(() => {
  setTourSearchShowsDemo(false)
  vi.useRealTimers()
})

describe('SearchAnnouncer', () => {
  it('renders into the body-level #tm-dnd-aux-host, outside the app root', () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    render(<SearchAnnouncer groups={groups} />, { container: root })
    const el = screen.getByTestId('search-announcer')
    expect(el.closest('#tm-dnd-aux-host')).not.toBeNull()
    expect(root.contains(el)).toBe(false)
    root.remove()
  })

  it('is an always-present polite status region and says nothing without a query', () => {
    render(<SearchAnnouncer groups={groups} />)
    const el = screen.getByTestId('search-announcer')
    expect(el).toHaveAttribute('role', 'status')
    expect(el).toHaveAttribute('aria-live', 'polite')
    wait()
    expect(say()).toBe('')
  })

  it('announces the count of matching tabs across all groups after the typing delay', () => {
    render(<SearchAnnouncer groups={groups} />)
    search('alpha')
    expect(say()).toBe('') // not yet: a word being typed is announced once
    wait(SEARCH_ANNOUNCE_DELAY_MS - 1)
    expect(say()).toBe('')
    wait(1)
    expect(say()).toBe('3 tabs match in 2 groups')
  })

  it('says "No tabs match" when nothing matches, and singular wording for one', () => {
    render(<SearchAnnouncer groups={groups} />)
    search('zzzz')
    wait()
    expect(say()).toBe('No tabs match')
    search('gamma')
    wait()
    expect(say()).toBe('1 tab matches in 1 group')
  })

  it('typing again restarts the delay (one announcement per word)', () => {
    render(<SearchAnnouncer groups={groups} />)
    search('gam')
    wait(300)
    search('alpha')
    wait(300)
    expect(say()).toBe('')
    wait(200)
    expect(say()).toBe('3 tabs match in 2 groups')
  })

  it('clears the message when the search is cleared', () => {
    render(<SearchAnnouncer groups={groups} />)
    search('alpha')
    wait()
    expect(say()).not.toBe('')
    search('')
    expect(say()).toBe('')
  })

  it('leaves out archived groups and the tour practice groups, except while a tour search step is up', () => {
    const all = [...groups, group('arch', ['alpha x'], { archived: true }), group('demo', ['alpha demo'], { tourDemo: true })]
    const { rerender } = render(<SearchAnnouncer groups={all} />)
    search('alpha')
    wait()
    expect(say()).toBe('3 tabs match in 2 groups')
    act(() => setTourSearchShowsDemo(true))
    rerender(<SearchAnnouncer groups={all} />)
    wait()
    expect(say()).toBe('4 tabs match in 3 groups')
  })
})
