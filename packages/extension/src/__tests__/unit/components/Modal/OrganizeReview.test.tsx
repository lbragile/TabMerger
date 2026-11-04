/**
 * The Organize review modal: one checked row per proposed action in plain words (local group
 * names, AI delete shown as Archive), unchecking leaves an action out, Apply runs ONE mutation
 * with the checked ones, Cancel changes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { OrganizeAction } from '@tabmerger/shared'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { Group } from '@/lib/types'

const { mockApply, mockApplyState, mockGroups, mockToast } = vi.hoisted(() => ({
  mockApply: vi.fn(),
  mockApplyState: { isPending: false },
  mockGroups: { data: undefined as unknown },
  mockToast: { success: vi.fn(), info: vi.fn(), error: vi.fn() }
}))

vi.mock('@/hooks/useGroups', () => ({ useGroups: () => mockGroups }))
vi.mock('@/hooks/useApplyOrganize', () => ({ useApplyOrganize: () => ({ mutateAsync: mockApply, ...mockApplyState }) }))
vi.mock('@/lib/toast', () => ({ toast: mockToast }))

import { OrganizeReviewModal } from '@/components/Modal/OrganizeReview'

const group = (id: string, name: string, over: Partial<Group> = {}): Group => ({ id, name, color: 'rgba(0,0,0,1)', updatedAt: 1, windows: [], ...over })

const ACTIONS: OrganizeAction[] = [
  { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' },
  { type: 'rename', groupId: 'c', newName: 'Reading' },
  { type: 'delete', groupId: 'd' },
  { type: 'reorder', groupIds: ['c', 'b'] }
]

function renderModal(actions: unknown = ACTIONS, onClose = vi.fn()) {
  render(
    <Dialog open>
      <DialogContent>
        <OrganizeReviewModal data={{ actions }} onClose={onClose} />
      </DialogContent>
    </Dialog>
  )
  return { onClose }
}

const checkboxes = () => screen.getAllByRole('checkbox') as HTMLInputElement[]
const applyButton = () => screen.getByRole('button', { name: 'Apply selected' })

beforeEach(() => {
  vi.clearAllMocks()
  mockApplyState.isPending = false
  mockApply.mockResolvedValue({ applied: 4 })
  mockGroups.data = {
    active: { id: 'now', index: 0 },
    available: [group('now', 'Now Open', { permanent: true }), group('a', 'Shopping'), group('b', 'Errands'), group('c', 'Docs'), group('d', 'Old stuff')]
  }
})

describe('OrganizeReviewModal', () => {
  it('lists every action in plain words with the local group names, all checked', () => {
    renderModal()
    expect(screen.getByRole('checkbox', { name: 'Merge “Shopping” into “Errands”' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Rename “Docs” to “Reading”' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Archive “Old stuff”' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Reorder groups/ })).toBeChecked()
    expect(screen.getByText("AI suggests 4 changes. Uncheck any you don't want.")).toBeTruthy()
    // the AI's delete is offered as Archive, with the reassurance it is reversible
    expect(screen.queryByText(/Delete/)).toBeNull()
    expect(screen.getByText(/Archived groups are hidden, not deleted/)).toBeTruthy()
  })

  it('shows the new order of a reorder as one chip per group', () => {
    renderModal([{ type: 'reorder', groupIds: ['c', 'b', 'gone'] }])
    const row = screen.getByRole('checkbox', { name: /Reorder groups/ }).closest('label') as HTMLElement
    expect([...row.querySelectorAll('bdi')].map((b) => b.textContent)).toEqual(['Docs', 'Errands'])
    expect(screen.queryByText(/Archived groups are hidden/)).toBeNull()
  })

  it('keeps names with markup as plain text, isolated and titled in full', () => {
    mockGroups.data = { active: { id: 'now', index: 0 }, available: [group('a', '<b>bold</b>'), group('b', 'B')] }
    renderModal([{ type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' }])
    const name = screen.getByTitle('<b>bold</b>')
    expect(name.tagName).toBe('BDI')
    expect(name.textContent).toBe('<b>bold</b>')
  })

  it('leaves out rows whose group is no longer here', () => {
    renderModal([
      { type: 'merge', sourceGroupId: 'gone', targetGroupId: 'b' },
      { type: 'rename', groupId: 'gone', newName: 'X' },
      { type: 'delete', groupId: 'gone' },
      { type: 'reorder', groupIds: ['gone', 'b'] },
      { type: 'delete', groupId: 'd' }
    ])
    expect(checkboxes()).toHaveLength(1)
    expect(screen.getByText("AI suggests 1 change. Uncheck any you don't want.")).toBeTruthy()
  })

  it('treats malformed modal data as no actions', () => {
    renderModal('nope')
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(applyButton()).toBeDisabled()
  })

  it('Apply runs ONE mutation with every checked action, then closes and toasts the count', async () => {
    const { onClose } = renderModal()
    fireEvent.click(applyButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(mockApply).toHaveBeenCalledWith(ACTIONS)
    expect(mockToast.success).toHaveBeenCalledWith('Applied 4 changes')
  })

  it('unchecking an action leaves it out; checking it again puts it back', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Archive “Old stuff”' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Merge “Shopping” into “Errands”' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Merge “Shopping” into “Errands”' }))
    expect(screen.getByRole('checkbox', { name: 'Archive “Old stuff”' })).not.toBeChecked()
    fireEvent.click(applyButton())
    await waitFor(() => expect(mockApply).toHaveBeenCalledTimes(1))
    expect(mockApply).toHaveBeenCalledWith([ACTIONS[0], ACTIONS[1], ACTIONS[3]])
  })

  it('disables Apply when nothing is checked', () => {
    renderModal([{ type: 'delete', groupId: 'd' }])
    fireEvent.click(checkboxes()[0])
    expect(applyButton()).toBeDisabled()
  })

  it('Cancel closes without applying anything', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(mockApply).not.toHaveBeenCalled()
  })

  it('says so when nothing could be applied (the groups changed meanwhile)', async () => {
    mockApply.mockResolvedValue({ applied: 0 })
    renderModal()
    fireEvent.click(applyButton())
    await waitFor(() => expect(mockToast.info).toHaveBeenCalledWith('Nothing to apply: those groups changed in the meantime'))
    expect(mockToast.success).not.toHaveBeenCalled()
  })

  it('shows an error and stays open when applying fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockApply.mockRejectedValue(new Error('disk full'))
    const { onClose } = renderModal()
    fireEvent.click(applyButton())
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Could not apply the changes'))
    expect(onClose).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('disables both buttons while applying', () => {
    mockApplyState.isPending = true
    renderModal()
    expect(applyButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
