import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GroupGrid } from '@/components/dashboard/GroupGrid'
import { SessionCard } from '@/components/dashboard/SessionCard'

/**
 * A "locked" item is one whose content could not be decrypted with the current key. It says so
 * inside the item itself, and every action that needs the content is refused: a locked group is
 * never shared (alone or in a bundle) and a locked session is never restored.
 */

const createSharedBundle = vi.fn(async (_groups: { id: string }[]) => 'https://example.com/share/slug#key=k')
vi.mock('@/lib/sharing', () => ({
  createSharedBundle: (groups: { id: string }[]) => createSharedBundle(groups),
}))

const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() },
}))

const writeText = vi.fn().mockResolvedValue(undefined)

// The grid sorts by `updated_at`, newest first. One shared timestamp keeps the fixtures in the order
// they are passed; the locked group is a minute older so it always renders after a readable one.
const NOW = Date.now()

const readable = (id: string, name: string) => ({
  id,
  name,
  color: 'rgba(0,180,204,1)',
  windows: [{ tabs: [{ title: `${name} tab`, url: 'https://example.com' }] }],
  updated_at: new Date(NOW).toISOString(),
})

/** What GroupGrid's decrypt pass produces for a group it could not read. */
const locked = (id: string) => ({
  ...readable(id, '(locked)'),
  windows: [],
  locked: true,
  updated_at: new Date(NOW - 60_000).toISOString(),
})

const INDICATION = /can't be read|earlier passphrase/i

beforeEach(() => {
  createSharedBundle.mockClear()
  toastError.mockClear()
  writeText.mockClear()
  Object.assign(navigator, { clipboard: { writeText } })
})

describe('locked group', () => {
  it.each(['grid', 'list'] as const)('shows the indication inside the locked item only (%s view)', (view) => {
    localStorage.setItem('tm-dashboard-view', view)
    render(<GroupGrid groups={[readable('g1', 'Work'), locked('g2')]} isPro />)

    const notes = screen.getAllByText(INDICATION)
    expect(notes).toHaveLength(1)
    expect(notes[0].closest('p')!.querySelector('svg')).not.toBeNull()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    const [readableShare, lockedShare] = screen.getAllByRole('button', { name: 'Share group' })
    expect(readableShare).not.toHaveAttribute('aria-disabled')
    expect(readableShare).not.toHaveAttribute('aria-describedby')
    expect(lockedShare).toHaveAttribute('aria-disabled', 'true')
    expect(document.getElementById(lockedShare.getAttribute('aria-describedby')!)).toBe(notes[0].closest('p'))
  })

  it('does not claim "0 windows · 0 tabs" for content it cannot read', () => {
    render(<GroupGrid groups={[locked('g2')]} isPro />)

    expect(screen.queryByText(/0 windows · 0 tabs/)).not.toBeInTheDocument()
  })

  it('offers no action that needs its content (open all, show tabs)', () => {
    render(<GroupGrid groups={[locked('g2')]} isPro />)

    expect(screen.queryByRole('button', { name: /Open all/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show tabs/ })).not.toBeInTheDocument()
  })

  it('refuses a click on its Share control without creating a link', () => {
    render(<GroupGrid groups={[locked('g2')]} isPro />)

    fireEvent.click(screen.getByRole('button', { name: 'Share group' }))

    expect(createSharedBundle).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it.each(['grid', 'list'] as const)('cannot be picked in Select mode (%s view)', (view) => {
    localStorage.setItem('tm-dashboard-view', view)
    render(<GroupGrid groups={[readable('g1', 'Work'), locked('g2')]} isPro />)
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))

    fireEvent.click(screen.getByText('(locked)'))
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Work'))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('has a disabled checkbox in Select mode that says it cannot be selected', () => {
    render(<GroupGrid groups={[readable('g1', 'Work'), locked('g2')]} isPro />)
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))

    const checkbox = screen.getByRole('button', { name: /can't be selected/i })
    expect(checkbox).toBeDisabled()
    fireEvent.click(checkbox)
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument()
  })

  it('is left out of a bundle even when it was selected before it became unreadable', async () => {
    const { rerender } = render(<GroupGrid groups={[readable('g1', 'Work'), readable('g2', 'Play')]} isPro />)
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    fireEvent.click(screen.getByText('Work'))
    fireEvent.click(screen.getByText('Play'))
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    rerender(<GroupGrid groups={[readable('g1', 'Work'), locked('g2')]} isPro />)
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Share selected/ }))

    await waitFor(() => expect(createSharedBundle).toHaveBeenCalledTimes(1))
    expect(createSharedBundle.mock.calls[0][0].map((g) => g.id)).toEqual(['g1'])
  })

  it('offers no "Share selected" when the only selected group became unreadable', () => {
    const { rerender } = render(<GroupGrid groups={[readable('g1', 'Work')]} isPro />)
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    fireEvent.click(screen.getByText('Work'))
    expect(screen.getByRole('button', { name: /Share selected/ })).toBeInTheDocument()

    rerender(<GroupGrid groups={[locked('g1')]} isPro />)

    expect(screen.queryByRole('button', { name: /Share selected/ })).not.toBeInTheDocument()
    expect(createSharedBundle).not.toHaveBeenCalled()
  })
})

describe('locked session card', () => {
  const props = {
    id: 's1',
    name: '(locked)',
    groups: [],
    groupCount: 0,
    windowCount: 0,
    tabCount: 0,
    createdAt: new Date().toISOString(),
  }

  it('shows the indication, disables Restore with the reason, and never calls the restore handler', () => {
    const onRestore = vi.fn()
    const { container } = render(<SessionCard {...props} locked onRestore={onRestore} onDelete={vi.fn()} />)

    const note = screen.getByText(INDICATION)
    expect(note.closest('p')!.querySelector('svg')).not.toBeNull()
    const restore = screen.getByRole('button', { name: 'Restore session' })
    expect(restore).toHaveAttribute('aria-disabled', 'true')
    expect(document.getElementById(restore.getAttribute('aria-describedby')!)).toBe(note.closest('p'))

    fireEvent.click(restore)
    expect(onRestore).not.toHaveBeenCalled()
    // No counts for content that could not be read.
    expect(within(container).queryByText('0 tabs')).not.toBeInTheDocument()
  })

  it('still deletes', () => {
    const onDelete = vi.fn()
    render(<SessionCard {...props} locked onRestore={vi.fn()} onDelete={onDelete} />)

    const del = screen.getByRole('button', { name: 'Delete session' })
    expect(del).not.toHaveAttribute('aria-disabled')
    expect(del).toBeEnabled()
    fireEvent.click(del)
    expect(onDelete).toHaveBeenCalledWith('s1')
  })

  it('shows no indication and restores normally when it is readable', () => {
    const onRestore = vi.fn()
    render(<SessionCard {...props} name="Monday" onRestore={onRestore} onDelete={vi.fn()} />)

    expect(screen.queryByText(INDICATION)).not.toBeInTheDocument()
    const restore = screen.getByRole('button', { name: 'Restore session' })
    expect(restore).not.toHaveAttribute('aria-disabled')
    fireEvent.click(restore)
    expect(onRestore).toHaveBeenCalledWith('s1')
  })
})
