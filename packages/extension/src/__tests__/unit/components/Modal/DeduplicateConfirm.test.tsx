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

describe('DeduplicateConfirmModal', () => {
  it('lists duplicate tabs and pluralizes correctly', () => {
    const duplicates = [
      { id: 1, title: 'Dup A', url: 'https://a.com' },
      { id: 2, title: 'Dup B', url: 'https://b.com' },
    ]
    renderModal(<DeduplicateConfirmModal data={{ groupIndex: 0, duplicates }} onClose={vi.fn()} />)
    expect(screen.getByText('Dup A')).toBeTruthy()
    expect(screen.getByText('Dup B')).toBeTruthy()
    expect(screen.getByText(/2 duplicate tabs will be removed/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /remove 2 duplicates/i })).toBeTruthy()
  })

  it('singularizes when only one duplicate', () => {
    renderModal(<DeduplicateConfirmModal data={{ groupIndex: 0, duplicates: [{ id: 1, title: 'Solo', url: 'https://a.com' }] }} onClose={vi.fn()} />)
    expect(screen.getByText(/1 duplicate tab will be removed/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /remove 1 duplicate$/i })).toBeTruthy()
  })

  it('confirm calls deduplicate with groupIndex and duplicate ids, closing onSuccess', () => {
    const duplicates = [{ id: 5, title: 'X', url: 'https://x.com' }, { id: 9, title: 'Y', url: 'https://y.com' }]
    const onClose = vi.fn()
    mockDeduplicate.mockImplementation((_vars, opts) => opts?.onSuccess?.())
    renderModal(<DeduplicateConfirmModal data={{ groupIndex: 3, duplicates }} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /remove 2 duplicates/i }))
    expect(mockDeduplicate).toHaveBeenCalledWith(
      { groupIndex: 3, duplicateIds: [5, 9] },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('cancel calls onClose without deduplicating', () => {
    const onClose = vi.fn()
    renderModal(<DeduplicateConfirmModal data={{ groupIndex: 0, duplicates: [] }} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockDeduplicate).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
