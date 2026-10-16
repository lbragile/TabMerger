import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
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
    return { mutateAsync: mockAddGroup, isPending: false }
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

  it('submits with default name and color when unchanged, and closes once the group exists', async () => {
    let added!: () => void
    mockAddGroup.mockImplementationOnce(() => new Promise<void>((resolve) => { added = resolve }))
    const onClose = vi.fn()
    renderModal(<AddGroupModal onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(mockAddGroup).toHaveBeenCalledWith({ name: DEFAULT_GROUP_TITLE, color: DEFAULT_GROUP_COLOR })
    // not before: a refused add (the free-plan backstop) keeps the dialog open
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => added())
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

  it('calls data.onCreated with the current available.length (new group index) once the add resolved', async () => {
    let added!: () => void
    mockAddGroup.mockImplementationOnce(() => new Promise<void>((resolve) => { added = resolve }))
    const onCreated = vi.fn().mockResolvedValue(undefined)
    groupsState = { available: [{ id: 'g0' }, { id: 'g1' }, { id: 'g2' }], active: { id: '', index: 0 } }
    renderModal(<AddGroupModal onClose={vi.fn()} data={{ onCreated }} />)
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(onCreated).not.toHaveBeenCalled()
    await act(async () => added())
    expect(onCreated).toHaveBeenCalledWith(3)
  })

  it('a refused add keeps the dialog open and never calls onCreated', async () => {
    mockAddGroup.mockRejectedValueOnce(new Error('FreeLimitExceeded'))
    const onCreated = vi.fn()
    const onClose = vi.fn()
    renderModal(<AddGroupModal onClose={onClose} data={{ onCreated }} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create/i }))
    })
    expect(onCreated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not throw and closes when no data prop is passed', async () => {
    mockAddGroup.mockResolvedValueOnce(undefined)
    const onClose = vi.fn()
    renderModal(<AddGroupModal onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('the draft preview swatch updates live while the colour picker is open, without persisting', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 0
    })
    renderModal(<AddGroupModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Color' }))
    const hexInput = screen.getByPlaceholderText('#rrggbb')
    fireEvent.change(hexInput, { target: { value: '#123456' } })
    expect(screen.getByTestId('add-group-color-preview')).toHaveStyle({ backgroundColor: '#123456' })
    expect(mockAddGroup).not.toHaveBeenCalled()
    rafSpy.mockRestore()
  })

  it('the colour picker is a popover, not rendered inline in the dialog until opened', () => {
    renderModal(<AddGroupModal onClose={vi.fn()} />)
    expect(screen.queryByPlaceholderText('#rrggbb')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Color' }))
    expect(screen.getByPlaceholderText('#rrggbb')).toBeInTheDocument()
  })

  it('Cancel in the colour picker reverts the draft preview swatch and submits the original color', () => {
    renderModal(<AddGroupModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Color' }))
    fireEvent.change(screen.getByPlaceholderText('#rrggbb'), { target: { value: '#123456' } })
    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelButtons[cancelButtons.length - 1])
    expect(screen.getByTestId('add-group-color-preview')).toHaveStyle({ backgroundColor: DEFAULT_GROUP_COLOR })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(mockAddGroup).toHaveBeenCalledWith({ name: DEFAULT_GROUP_TITLE, color: DEFAULT_GROUP_COLOR })
  })

  it('Apply in the colour picker commits the draft color used on submit and closes the picker', () => {
    renderModal(<AddGroupModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Color' }))
    fireEvent.change(screen.getByPlaceholderText('#rrggbb'), { target: { value: '#123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.queryByPlaceholderText('#rrggbb')).not.toBeInTheDocument()
    expect(screen.getByTestId('add-group-color-preview')).toHaveStyle({ backgroundColor: '#123456' })
    expect(screen.getByRole('button', { name: 'Color' })).toHaveTextContent('#123456')
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(mockAddGroup).toHaveBeenCalledWith({ name: DEFAULT_GROUP_TITLE, color: 'rgba(18, 52, 86, 1)' })
  })
})
