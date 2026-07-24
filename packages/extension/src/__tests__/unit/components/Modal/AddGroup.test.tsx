import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { AddGroupModal } from '@/components/Modal/AddGroup'
import { DEFAULT_GROUP_TITLE, DEFAULT_GROUP_COLOR } from '@/lib/types'

function renderModal(ui: React.ReactElement) {
  return render(<Dialog open><DialogContent>{ui}</DialogContent></Dialog>)
}

const { mockAddGroup } = vi.hoisted(() => ({ mockAddGroup: vi.fn() }))

vi.mock('@/hooks/useGroups', () => ({
  useAddGroup: () => ({ mutate: mockAddGroup, isPending: false }),
}))

beforeEach(() => vi.clearAllMocks())

describe('AddGroupModal', () => {
  it('submits with default name and color when unchanged', () => {
    const onClose = vi.fn()
    renderModal(<AddGroupModal onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(mockAddGroup).toHaveBeenCalledWith({ name: DEFAULT_GROUP_TITLE, color: DEFAULT_GROUP_COLOR })
    expect(onClose).toHaveBeenCalled()
  })

  it('submits with typed name trimmed', () => {
    renderModal(<AddGroupModal onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  My Group  ' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(mockAddGroup).toHaveBeenCalledWith({ name: 'My Group', color: DEFAULT_GROUP_COLOR })
  })

  it('falls back to default name when input is blank', () => {
    renderModal(<AddGroupModal onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(mockAddGroup).toHaveBeenCalledWith({ name: DEFAULT_GROUP_TITLE, color: DEFAULT_GROUP_COLOR })
  })

  it('cancel calls onClose without adding a group', () => {
    const onClose = vi.fn()
    renderModal(<AddGroupModal onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockAddGroup).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
