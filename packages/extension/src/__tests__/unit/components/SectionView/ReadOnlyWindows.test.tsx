import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ReadOnlyWindows, customWindowName } from '@/components/SectionView/ReadOnlyWindows'
import { DEFAULT_WINDOW_TITLE } from '@/lib/types'
import { FALLBACK_FAVICON } from '@/lib/savedTab'
import type { Tab, Window } from '@/lib/types'

const h = vi.hoisted(() => ({ openInGroup: vi.fn() }))
vi.mock('@/lib/chromeGroups', () => ({ openTabInChromeGroup: h.openInGroup }))

const create = vi.fn().mockResolvedValue({})
const tab = (url: string, extra: Partial<Tab> = {}): Tab => ({ id: 0, title: url, url, ...extra })
const win = (tabs: Tab[], extra: Partial<Window> = {}): Window => ({ id: 1, tabs, incognito: false, focused: false, ...extra })
const props = { groupName: 'Launch', color: 'rgba(234, 179, 8, 1)' }

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as { chrome?: unknown }).chrome = { tabs: { create }, tabGroups: {} }
})

describe('ReadOnlyWindows', () => {
  it('shows the empty text for no windows', () => {
    render(<ReadOnlyWindows {...props} windows={[]} />)
    expect(screen.getByText('No windows in this group')).toBeInTheDocument()
  })

  it('disables the button of a tab whose URL may not be opened, and never opens it', () => {
    render(<ReadOnlyWindows {...props} windows={[win([tab('javascript:alert(1)', { title: 'Bad' }), tab('https://ok.test/', { title: 'Good' })])]} />)
    const bad = screen.getByRole('button', { name: /Bad/ })
    expect(bad).toBeDisabled()
    fireEvent.click(bad)
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Good/ })).toBeEnabled()
  })

  it('a tab saved in a browser tab group opens through openTabInChromeGroup (focused)', () => {
    const grouped = tab('https://g.test/', { title: 'Grouped', chromeGroup: { id: 4, name: 'Research', color: 'blue' } })
    render(<ReadOnlyWindows {...props} windows={[win([grouped])]} />)
    fireEvent.click(screen.getByRole('button', { name: /Grouped/ }))
    expect(h.openInGroup).toHaveBeenCalledWith(grouped, undefined, true)
    expect(create).not.toHaveBeenCalled()
  })

  it('uses the fallback favicon when none is saved, and swaps to it when the saved one fails', () => {
    const { container } = render(<ReadOnlyWindows {...props} windows={[win([tab('https://a.test/', { favIconUrl: 'https://a.test/x.png' }), tab('https://b.test/')])]} />)
    const imgs = [...container.querySelectorAll('img')]
    expect(imgs[0]).toHaveAttribute('src', 'https://a.test/x.png')
    expect(imgs[1]).toHaveAttribute('src', FALLBACK_FAVICON)
    fireEvent.error(imgs[0])
    expect(imgs[0]).toHaveAttribute('src', FALLBACK_FAVICON)
  })

  it('Up/Down/Home/End move focus between tabs, clamp at the ends, and are consumed', () => {
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    render(<ReadOnlyWindows {...props} windows={[win([tab('https://a.test/'), tab('https://b.test/')]), win([tab('https://c.test/')])]} />)
    const [a, b, c] = screen.getAllByRole('button')
    a.focus()
    fireEvent.keyDown(a, { key: 'ArrowUp' })
    expect(a).toHaveFocus()
    fireEvent.keyDown(a, { key: 'ArrowDown' })
    expect(b).toHaveFocus()
    fireEvent.keyDown(b, { key: 'End' })
    expect(c).toHaveFocus()
    fireEvent.keyDown(c, { key: 'ArrowDown' })
    expect(c).toHaveFocus()
    fireEvent.keyDown(c, { key: 'Home' })
    expect(a).toHaveFocus()
    expect(outer).toHaveBeenCalledTimes(5)
    expect(outer.mock.calls.every(([e]) => (e as KeyboardEvent).defaultPrevented)).toBe(true)
    document.removeEventListener('keydown', outer)
  })

  it('leaves modified arrows and other keys alone (not consumed)', () => {
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    render(<ReadOnlyWindows {...props} windows={[win([tab('https://a.test/'), tab('https://b.test/')])]} />)
    const [a, b] = screen.getAllByRole('button')
    a.focus()
    fireEvent.keyDown(a, { key: 'ArrowDown', altKey: true })
    fireEvent.keyDown(a, { key: 'ArrowDown', ctrlKey: true })
    fireEvent.keyDown(a, { key: 'a' })
    expect(a).toHaveFocus()
    expect(b).not.toHaveFocus()
    expect(outer.mock.calls.every(([e]) => !(e as KeyboardEvent).defaultPrevented)).toBe(true)
    document.removeEventListener('keydown', outer)
  })
})

describe('ReadOnlyWindows — window brackets', () => {
  const gutter = (group: HTMLElement) => group.querySelector('[data-window-gutter]') as HTMLElement

  it('names each window "<group>, window N, <count>", plural-aware, and hides the gutter from screen readers', () => {
    render(<ReadOnlyWindows {...props} windows={[win([tab('https://a.test/'), tab('https://b.test/')]), win([tab('https://c.test/')]), win([])]} />)
    const groups = screen.getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Launch, window 1, 2 tabs', 'Launch, window 2, 1 tab', 'Launch, window 3, 0 tabs'])
    for (const g of groups) expect(gutter(g)).toHaveAttribute('aria-hidden', 'true')
    // the tile number and the count under it
    expect(gutter(groups[0]).textContent).toBe('12 tabs')
    expect(gutter(groups[1]).textContent).toBe('21 tab')
  })

  it('shows a custom window name above its first tab and puts it in the accessible name', () => {
    render(<ReadOnlyWindows {...props} windows={[win([tab('https://a.test/')], { name: 'Research' }), win([tab('https://b.test/')], { name: DEFAULT_WINDOW_TITLE })]} />)
    const [named, plain] = screen.getAllByRole('group')
    expect(named).toHaveAccessibleName('Launch, Research, window 1, 1 tab')
    const label = within(named).getByText('Research')
    expect(label).toHaveAttribute('aria-hidden', 'true')
    expect(label.compareDocumentPosition(within(named).getByRole('button'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    // the placeholder new windows get is not a name
    expect(plain).toHaveAccessibleName('Launch, window 2, 1 tab')
    expect(within(plain).queryByText(DEFAULT_WINDOW_TITLE)).toBeNull()
  })

  it('customWindowName ignores blank names and the placeholder', () => {
    expect(customWindowName({ name: '  Mail  ' })).toBe('Mail')
    expect(customWindowName({ name: '   ' })).toBeUndefined()
    expect(customWindowName({})).toBeUndefined()
    expect(customWindowName({ name: DEFAULT_WINDOW_TITLE })).toBeUndefined()
  })

  it('draws the tile in the group colour with readable text, the rail and foot from the same colour', () => {
    render(<ReadOnlyWindows {...props} windows={[win([tab('https://a.test/')])]} />)
    const group = screen.getByRole('group')
    expect(group.style.getPropertyValue('--item-color')).toBe(props.color)
    const tile = gutter(group).querySelector('[data-window-tile] > span') as HTMLElement
    expect(tile.style.backgroundColor).toBe('rgb(234, 179, 8)')
    // yellow: black text (white would be under 4.5:1)
    expect(tile.style.color).toBe('rgb(0, 0, 0)')
    expect(gutter(group).querySelectorAll('.tm-bracket-rail')).toHaveLength(2)
  })

  it('the tile block is sticky: at the top of the scroll area alone, under the group header in a session', () => {
    const { unmount } = render(<ReadOnlyWindows {...props} windows={[win([tab('https://a.test/')])]} />)
    let block = screen.getByRole('group').querySelector('[data-window-tile]') as HTMLElement
    expect(block).toHaveClass('sticky', 'top-2', 'bg-background')
    unmount()
    render(<ReadOnlyWindows {...props} underGroupHeader windows={[win([tab('https://a.test/')])]} />)
    block = screen.getByRole('group').querySelector('[data-window-tile]') as HTMLElement
    expect(block).toHaveClass('sticky', 'top-[calc(var(--section-group-header)+0.5rem)]')
  })

  it('a row shows the site on the end side and an "opens in a tab" icon hidden from screen readers', () => {
    render(<ReadOnlyWindows {...props} windows={[win([tab('https://www.docs.test/a/b?q=1', { title: 'Docs' })])]} />)
    const row = screen.getByRole('button', { name: /Docs/ })
    expect(row).toHaveAccessibleName('Docs docs.test')
    const icon = row.querySelector('[data-opens-tab-icon]') as Element
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveClass('opacity-0', 'group-hover/row:opacity-100', 'group-focus-visible/row:opacity-100')
  })

  it('rows are not Tab stops of their own beyond being buttons (no tabindex), and arrows cross windows', () => {
    render(<ReadOnlyWindows {...props} windows={[win([tab('https://a.test/')]), win([tab('https://b.test/')])]} />)
    const [a, b] = screen.getAllByRole('button')
    for (const x of [a, b]) expect(x).not.toHaveAttribute('tabindex')
    a.focus()
    fireEvent.keyDown(a, { key: 'ArrowDown' })
    expect(b).toHaveFocus()
    expect(within(screen.getByRole('group', { name: 'Launch, window 2, 1 tab' })).getByRole('button')).toHaveFocus()
  })
})
