import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { DeduplicateConfirmModal } from '@/components/Modal/DeduplicateConfirm'

function renderModal(ui: React.ReactElement) {
  return render(<Dialog open><DialogContent>{ui}</DialogContent></Dialog>)
}

const { mockDeduplicate } = vi.hoisted(() => ({ mockDeduplicate: vi.fn() }))

vi.mock('@/hooks/useGroups', () => ({
  useDeduplicateGroup: () => ({ mutate: mockDeduplicate, isPending: false }),
}))

beforeEach(() => vi.clearAllMocks())

/** A `findDuplicateTabs` entry: the tab plus its position in the group. */
function dup(windowIndex: number, tabIndex: number, tab: { id: number; title: string; url: string }) {
  return { windowIndex, tabIndex, tab }
}

describe('DeduplicateConfirmModal', () => {
  it('lists duplicate tabs and pluralizes correctly', () => {
    const duplicates = [
      dup(0, 1, { id: 1, title: 'Dup A', url: 'https://a.com' }),
      dup(1, 0, { id: 2, title: 'Dup B', url: 'https://b.com' }),
    ]
    renderModal(<DeduplicateConfirmModal data={{ groupIndex: 0, duplicates }} onClose={vi.fn()} />)
    expect(screen.getByText('Dup A')).toBeTruthy()
    expect(screen.getByText('Dup B')).toBeTruthy()
    expect(screen.getByText(/2 duplicate tabs will be removed/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /remove 2 duplicates/i })).toBeTruthy()
  })

  it('singularizes when only one duplicate', () => {
    renderModal(<DeduplicateConfirmModal data={{ groupIndex: 0, duplicates: [dup(0, 1, { id: 1, title: 'Solo', url: 'https://a.com' })] }} onClose={vi.fn()} />)
    expect(screen.getByText(/1 duplicate tab will be removed/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /remove 1 duplicate$/i })).toBeTruthy()
  })

  it('confirm calls deduplicate with groupIndex and each duplicate\'s position and URL, closing onSuccess', () => {
    const duplicates = [
      dup(0, 2, { id: 5, title: 'X', url: 'https://x.com' }),
      dup(3, 0, { id: 9, title: 'Y', url: 'https://y.com' }),
    ]
    const onClose = vi.fn()
    mockDeduplicate.mockImplementation((_vars, opts) => opts?.onSuccess?.())
    renderModal(<DeduplicateConfirmModal data={{ groupIndex: 3, duplicates }} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /remove 2 duplicates/i }))
    expect(mockDeduplicate).toHaveBeenCalledWith(
      {
        groupIndex: 3,
        duplicates: [
          { windowIndex: 0, tabIndex: 2, url: 'https://x.com' },
          { windowIndex: 3, tabIndex: 0, url: 'https://y.com' },
        ],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('lists and sends saved duplicates that all share id 0 as separate entries', () => {
    const duplicates = [
      dup(0, 1, { id: 0, title: 'First', url: 'https://a.com' }),
      dup(1, 0, { id: 0, title: 'Second', url: 'https://a.com' }),
    ]
    renderModal(<DeduplicateConfirmModal data={{ groupIndex: 2, duplicates }} onClose={vi.fn()} />)
    expect(screen.getByText('First')).toBeTruthy()
    expect(screen.getByText('Second')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /remove 2 duplicates/i }))
    expect(mockDeduplicate.mock.calls[0][0]).toEqual({
      groupIndex: 2,
      duplicates: [
        { windowIndex: 0, tabIndex: 1, url: 'https://a.com' },
        { windowIndex: 1, tabIndex: 0, url: 'https://a.com' },
      ],
    })
  })

  it('cancel calls onClose without deduplicating', () => {
    const onClose = vi.fn()
    renderModal(<DeduplicateConfirmModal data={{ groupIndex: 0, duplicates: [] }} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockDeduplicate).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
