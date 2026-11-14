import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReadOnlyWindows } from '@/components/SectionView/ReadOnlyWindows'
import { FALLBACK_FAVICON } from '@/lib/savedTab'
import type { Tab, Window } from '@/lib/types'

const h = vi.hoisted(() => ({ openInGroup: vi.fn() }))
vi.mock('@/lib/chromeGroups', () => ({ openTabInChromeGroup: h.openInGroup }))

const create = vi.fn().mockResolvedValue({})
const tab = (url: string, extra: Partial<Tab> = {}): Tab => ({ id: 0, title: url, url, ...extra })
const win = (tabs: Tab[], extra: Partial<Window> = {}): Window => ({ id: 1, tabs, incognito: false, focused: false, ...extra })

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as { chrome?: unknown }).chrome = { tabs: { create }, tabGroups: {} }
})

describe('ReadOnlyWindows', () => {
  it('shows the empty text for no windows', () => {
    render(<ReadOnlyWindows windows={[]} />)
    expect(screen.getByText('No windows in this group')).toBeInTheDocument()
  })

  it('disables the button of a tab whose URL may not be opened, and never opens it', () => {
    render(<ReadOnlyWindows windows={[win([tab('javascript:alert(1)', { title: 'Bad' }), tab('https://ok.test/', { title: 'Good' })])]} />)
    const bad = screen.getByRole('button', { name: /Bad/ })
    expect(bad).toBeDisabled()
    fireEvent.click(bad)
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Good/ })).toBeEnabled()
  })

  it('a tab saved in a browser tab group opens through openTabInChromeGroup (focused)', () => {
    const grouped = tab('https://g.test/', { title: 'Grouped', chromeGroup: { id: 4, name: 'Research', color: 'blue' } })
    render(<ReadOnlyWindows windows={[win([grouped])]} />)
    fireEvent.click(screen.getByRole('button', { name: /Grouped/ }))
    expect(h.openInGroup).toHaveBeenCalledWith(grouped, undefined, true)
    expect(create).not.toHaveBeenCalled()
  })

  it('uses the fallback favicon when none is saved, and swaps to it when the saved one fails', () => {
    const { container } = render(<ReadOnlyWindows windows={[win([tab('https://a.test/', { favIconUrl: 'https://a.test/x.png' }), tab('https://b.test/')])]} />)
    const imgs = [...container.querySelectorAll('img')]
    expect(imgs[0]).toHaveAttribute('src', 'https://a.test/x.png')
    expect(imgs[1]).toHaveAttribute('src', FALLBACK_FAVICON)
    fireEvent.error(imgs[0])
    expect(imgs[0]).toHaveAttribute('src', FALLBACK_FAVICON)
  })

  it('Up/Down/Home/End move focus between tabs, clamp at the ends, and are consumed', () => {
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    render(<ReadOnlyWindows windows={[win([tab('https://a.test/'), tab('https://b.test/')]), win([tab('https://c.test/')])]} />)
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
    render(<ReadOnlyWindows windows={[win([tab('https://a.test/'), tab('https://b.test/')])]} />)
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
