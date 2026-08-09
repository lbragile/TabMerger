import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ReviewStaleGroupModal } from '@/components/Modal/ReviewStaleGroup'
import type { Group } from '@/lib/types'

function renderModal(ui: React.ReactElement) {
  return render(<Dialog open><DialogContent>{ui}</DialogContent></Dialog>)
}

const shopping = {
  id: 'g1',
  name: 'Shopping',
  color: 'rgba(255,0,0,1)',
  updatedAt: Date.now(),
  windows: [
    {
      id: 1,
      incognito: false,
      focused: false,
      tabs: [
        { id: 0, title: 'Amazon', url: 'https://amazon.com', favIconUrl: '' },
        { id: 0, title: 'Ebay', url: 'https://ebay.com', favIconUrl: '' },
      ],
    },
  ],
} as unknown as Group

const research = {
  id: 'g2',
  name: 'Research',
  color: 'rgba(0,0,255,1)',
  updatedAt: Date.now(),
  windows: [],
} as unknown as Group

describe('ReviewStaleGroupModal', () => {
  it('lists every stale group with name and window/tab counts', () => {
    renderModal(<ReviewStaleGroupModal data={{ groups: [shopping, research], onArchive: vi.fn() }} onClose={vi.fn()} />)
    expect(screen.getByText('Shopping')).toBeTruthy()
    expect(screen.getByText('Research')).toBeTruthy()
    expect(screen.getByText('1 window · 2 tabs')).toBeTruthy()
    expect(screen.getByText('0 windows · 0 tabs')).toBeTruthy()
  })

  it('auto-expands a single group and shows its tabs', () => {
    renderModal(<ReviewStaleGroupModal data={{ groups: [shopping], onArchive: vi.fn() }} onClose={vi.fn()} />)
    expect(screen.getByText('Amazon')).toBeTruthy()
    expect(screen.getByText('Ebay')).toBeTruthy()
  })

  it('Preview expands a group to show its tabs, Hide collapses it again', () => {
    renderModal(<ReviewStaleGroupModal data={{ groups: [shopping, research], onArchive: vi.fn() }} onClose={vi.fn()} />)
    expect(screen.queryByText('Amazon')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Preview' })[0])
    expect(screen.getByText('Amazon')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByText('Amazon')).toBeNull()
  })

  it('shows an empty-state message when an expanded group has no windows', () => {
    renderModal(<ReviewStaleGroupModal data={{ groups: [research], onArchive: vi.fn() }} onClose={vi.fn()} />)
    expect(screen.getByText('This group is empty.')).toBeTruthy()
  })

  it('Archive on a row calls onArchive with that group id without closing the modal', () => {
    const onClose = vi.fn()
    const onArchive = vi.fn()
    renderModal(<ReviewStaleGroupModal data={{ groups: [shopping, research], onArchive }} onClose={onClose} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[0])
    expect(onArchive).toHaveBeenCalledWith('g1')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Close calls onClose', () => {
    const onClose = vi.fn()
    renderModal(<ReviewStaleGroupModal data={{ groups: [shopping], onArchive: vi.fn() }} onClose={onClose} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])
    expect(onClose).toHaveBeenCalled()
  })
})
