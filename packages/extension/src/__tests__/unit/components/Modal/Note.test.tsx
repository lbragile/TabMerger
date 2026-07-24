import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { NoteModal } from '@/components/Modal/Note'

function renderModal(ui: React.ReactElement) {
  return render(<Dialog open><DialogContent>{ui}</DialogContent></Dialog>)
}

const { mockUpdateNote, mockUseGroups } = vi.hoisted(() => ({
  mockUpdateNote: vi.fn(),
  mockUseGroups: vi.fn(),
}))

vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => mockUseGroups(),
  useUpdateGroupNote: () => ({ mutate: mockUpdateNote }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockUseGroups.mockReturnValue({ data: { available: [{ note: 'existing note' }] } })
})

describe('NoteModal', () => {
  it('pre-fills the textarea with the existing note for the group', () => {
    renderModal(<NoteModal data={{ groupIndex: 0 }} onClose={vi.fn()} />)
    expect(screen.getByPlaceholderText(/add a note/i)).toHaveValue('existing note')
  })

  it('defaults to empty string when group has no note', () => {
    mockUseGroups.mockReturnValue({ data: { available: [{}] } })
    renderModal(<NoteModal data={{ groupIndex: 0 }} onClose={vi.fn()} />)
    expect(screen.getByPlaceholderText(/add a note/i)).toHaveValue('')
  })

  it('saves the edited note and closes', () => {
    const onClose = vi.fn()
    renderModal(<NoteModal data={{ groupIndex: 0 }} onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText(/add a note/i), { target: { value: 'updated note' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(mockUpdateNote).toHaveBeenCalledWith({ groupIndex: 0, note: 'updated note' })
    expect(onClose).toHaveBeenCalled()
  })

  it('cancel closes without saving', () => {
    const onClose = vi.fn()
    renderModal(<NoteModal data={{ groupIndex: 0 }} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockUpdateNote).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
