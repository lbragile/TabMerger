import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { AddGroupModal } from '@/components/Modal/AddGroup'
import { DEFAULT_GROUP_TITLE, DEFAULT_GROUP_COLOR } from '@/lib/types'

function renderModal(ui: React.ReactElement) {
  return render(<Dialog open><DialogContent>{ui}</DialogContent></Dialog>)
}

const { mockAddGroup, mockUseAddGroup } = vi.hoisted(() => ({ mockAddGroup: vi.fn(), mockUseAddGroup: vi.fn() }))

let groupsState = { available: [{ id: 'g0' }, { id: 'g1' }], active: { id: '', index: 0 } }

vi.mock('@/hooks/useGroups', () => ({
  useAddGroup: (caps: unknown) => {
    mockUseAddGroup(caps)
    return { mutate: mockAddGroup, isPending: false }
  },
  useGroups: () => ({ data: groupsState }),
}))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ maxGroups: 5, maxTabs: 50 }) }))

beforeEach(() => {
  vi.clearAllMocks()
  groupsState = { available: [{ id: 'g0' }, { id: 'g1' }], active: { id: '', index: 0 } }
})

describe('AddGroupModal', () => {
  it('passes the plan limits to useAddGroup so the Free-plan backstop applies to Create', () => {
    renderModal(<AddGroupModal onClose={vi.fn()} />)
    expect(mockUseAddGroup).toHaveBeenCalledWith({ maxGroups: 5, maxTabs: 50 })
  })

  it('submits with default name and color when unchanged', () => {
    const onClose = vi.fn()
    renderModal(<AddGroupModal onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(mockAddGroup).toHaveBeenCalledWith(
      { name: DEFAULT_GROUP_TITLE, color: DEFAULT_GROUP_COLOR },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
    // onClose must wait for the mutation's onSuccess, not fire synchronously — closing
    // (unmounting) before the async mutation settles would drop the mutate-level onSuccess
    // that onCreated (the actual move/copy trigger) depends on.
    expect(onClose).not.toHaveBeenCalled()
    const [, options] = mockAddGroup.mock.calls[0] as [unknown, { onSuccess: () => void }]
    options.onSuccess()
    expect(onClose).toHaveBeenCalled()
  })

  it('submits with typed name trimmed', () => {
    renderModal(<AddGroupModal onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  My Group  ' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(mockAddGroup).toHaveBeenCalledWith(
      { name: 'My Group', color: DEFAULT_GROUP_COLOR },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
  })

  it('falls back to default name when input is blank', () => {
    renderModal(<AddGroupModal onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(mockAddGroup).toHaveBeenCalledWith(
      { name: DEFAULT_GROUP_TITLE, color: DEFAULT_GROUP_COLOR },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
  })

  it('cancel calls onClose without adding a group', () => {
    const onClose = vi.fn()
    renderModal(<AddGroupModal onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockAddGroup).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('calls data.onCreated with the current available.length (new group index) on successful add', () => {
    const onCreated = vi.fn()
    groupsState = { available: [{ id: 'g0' }, { id: 'g1' }, { id: 'g2' }], active: { id: '', index: 0 } }
    renderModal(<AddGroupModal onClose={vi.fn()} data={{ onCreated }} />)
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    const [, options] = mockAddGroup.mock.calls[0] as [unknown, { onSuccess: () => void }]
    expect(onCreated).not.toHaveBeenCalled()
    options.onSuccess()
    expect(onCreated).toHaveBeenCalledWith(3)
  })

  it('does not throw and skips onCreated when no data prop is passed', () => {
    renderModal(<AddGroupModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    const [, options] = mockAddGroup.mock.calls[0] as [unknown, { onSuccess: () => void }]
    expect(() => options.onSuccess()).not.toThrow()
  })

  it('the draft preview swatch updates live while the Custom picker is open, without persisting', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 0
    })
    renderModal(<AddGroupModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }))
    const hexInput = screen.getByPlaceholderText('#rrggbb')
    fireEvent.change(hexInput, { target: { value: '#123456' } })
    expect(screen.getByTestId('add-group-color-preview')).toHaveStyle({ backgroundColor: '#123456' })
    expect(mockAddGroup).not.toHaveBeenCalled()
    rafSpy.mockRestore()
  })

  it('Cancel in the Custom picker reverts the draft preview swatch and submits the original color', () => {
    renderModal(<AddGroupModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }))
    fireEvent.change(screen.getByPlaceholderText('#rrggbb'), { target: { value: '#123456' } })
    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelButtons[cancelButtons.length - 1])
    expect(screen.getByTestId('add-group-color-preview')).toHaveStyle({ backgroundColor: DEFAULT_GROUP_COLOR })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(mockAddGroup).toHaveBeenCalledWith(
      { name: DEFAULT_GROUP_TITLE, color: DEFAULT_GROUP_COLOR },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
  })

  it('Apply in the Custom picker commits the draft color used on submit', () => {
    renderModal(<AddGroupModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }))
    fireEvent.change(screen.getByPlaceholderText('#rrggbb'), { target: { value: '#123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByTestId('add-group-color-preview')).toHaveStyle({ backgroundColor: '#123456' })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(mockAddGroup).toHaveBeenCalledWith(
      { name: DEFAULT_GROUP_TITLE, color: 'rgba(18, 52, 86, 1)' },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
  })
})
