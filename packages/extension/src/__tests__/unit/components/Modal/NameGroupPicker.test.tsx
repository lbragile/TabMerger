import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { NameGroupPickerModal } from '@/components/Modal/NameGroupPicker'
import type { Group } from '@/lib/types'

/**
 * "Name this group": the AI's suggestions as a labelled radiogroup (first preselected), a "type
 * your own" box that selects its option, Rename through the normal group rename at the group's
 * current position (found by id), and the keyboard (arrows, Enter, Escape).
 */

const h = vi.hoisted(() => ({
  groups: [] as Group[],
  updateGroupName: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}))

vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => ({ data: { active: { id: '', index: 0 }, available: h.groups } }),
  useUpdateGroupName: () => ({ mutateAsync: h.updateGroupName }),
}))
vi.mock('@/lib/toast', () => ({ toast: { error: h.toastError, info: h.toastInfo } }))

function group(id: string, name: string): Group {
  return { id, name, color: 'rgba(0,0,0,1)', updatedAt: 1, windows: [] }
}

const SUGGESTIONS = ['BC Election Coverage', 'Local News', 'Election Night']

function renderModal(data: Record<string, unknown> = { groupId: 'g1', suggestions: SUGGESTIONS }) {
  const onClose = vi.fn()
  render(
    React.createElement(Dialog, { open: true, onOpenChange: (open: boolean) => { if (!open) onClose() } },
      React.createElement(DialogContent, null, React.createElement(NameGroupPickerModal, { data, onClose }))
    )
  )
  return { onClose, user: userEvent.setup() }
}

const radio = (name: string) => screen.getByRole('radio', { name })
const customRadio = () => screen.getByRole('radio', { name: 'Or type your own:' })
const customBox = () => screen.getByRole('textbox', { name: 'Your own name' })
const renameButton = () => screen.getByRole('button', { name: 'Rename' })

beforeEach(() => {
  vi.clearAllMocks()
  h.groups = [group('g0', 'Now Open'), group('g1', 'Google')]
  h.updateGroupName.mockResolvedValue(undefined)
})

describe('NameGroupPickerModal — layout and a11y', () => {
  it('shows the title, the current name and a labelled radiogroup with the suggestions and "your own"', () => {
    renderModal()
    expect(screen.getByRole('dialog', { name: 'Name this group' })).toHaveTextContent('Currently: Google')
    const group = screen.getByRole('radiogroup', { name: 'Suggested names' })
    expect(group).toBeTruthy()
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual([...SUGGESTIONS, 'Or type your own:'])
    // The box sits outside the radiogroup (a radiogroup holds only radios)
    expect(group.contains(customBox())).toBe(false)
  })

  it('preselects the first suggestion, focuses it, and enables Rename', async () => {
    renderModal()
    expect(radio('BC Election Coverage')).toBeChecked()
    await waitFor(() => expect(radio('BC Election Coverage')).toHaveFocus())
    expect(renameButton()).toBeEnabled()
    // Roving tab stop: only the selected option is in the tab order
    expect(radio('BC Election Coverage')).toHaveAttribute('tabindex', '0')
    expect(radio('Local News')).toHaveAttribute('tabindex', '-1')
  })

  it('cleans the suggestions it is given (a defensive second pass)', () => {
    renderModal({ groupId: 'g1', suggestions: ['  Two\n words ', 42, ''] })
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(radio('Two words')).toBeChecked()
  })

  it('without usable suggestions, "your own" is selected', () => {
    renderModal({ groupId: 'g1', suggestions: 'nope' })
    expect(customRadio()).toBeChecked()
    expect(renameButton()).toBeDisabled()
  })
})

describe('NameGroupPickerModal — renaming', () => {
  it('renames to the preselected suggestion at the group\'s position, once, and closes', async () => {
    const { user, onClose } = renderModal()
    await user.click(renameButton())
    expect(h.updateGroupName).toHaveBeenCalledTimes(1)
    expect(h.updateGroupName).toHaveBeenCalledWith({ groupIndex: 1, name: 'BC Election Coverage' })
    expect(onClose).toHaveBeenCalled()
  })

  it('renames to the suggestion picked with the mouse', async () => {
    const { user } = renderModal()
    await user.click(screen.getByText('Election Night'))
    expect(radio('Election Night')).toBeChecked()
    await user.click(renameButton())
    expect(h.updateGroupName).toHaveBeenCalledWith({ groupIndex: 1, name: 'Election Night' })
  })

  it('typing in the box selects "your own"; the typed name is trimmed like a manual rename', async () => {
    const { user } = renderModal()
    await user.type(customBox(), '  My picks  ')
    expect(customRadio()).toBeChecked()
    expect(radio('BC Election Coverage')).not.toBeChecked()
    await user.click(renameButton())
    expect(h.updateGroupName).toHaveBeenCalledWith({ groupIndex: 1, name: 'My picks' })
  })

  it('a blank "your own" name cannot be renamed to', async () => {
    const { user } = renderModal()
    await user.type(customBox(), '   ')
    expect(customRadio()).toBeChecked()
    expect(renameButton()).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(h.updateGroupName).not.toHaveBeenCalled()
  })

  it('picking "your own" with the mouse moves focus into the box', async () => {
    const { user } = renderModal()
    await user.click(customRadio())
    expect(customRadio()).toBeChecked()
    expect(customBox()).toHaveFocus()
  })

  it('renames the group where it is NOW (found by id), after it moved', async () => {
    h.groups = [group('g0', 'Now Open'), group('g2', 'Other'), group('g3', 'More'), group('g1', 'Google')]
    const { user } = renderModal()
    await user.click(renameButton())
    expect(h.updateGroupName).toHaveBeenCalledWith({ groupIndex: 3, name: 'BC Election Coverage' })
  })

  it('a group deleted meanwhile: Rename is disabled, and Enter toasts and closes without writing', async () => {
    h.groups = [group('g0', 'Now Open')]
    const { user, onClose } = renderModal()
    expect(screen.getByRole('dialog')).toHaveTextContent('Currently:')
    expect(renameButton()).toBeDisabled()
    await waitFor(() => expect(radio('BC Election Coverage')).toHaveFocus())
    await user.keyboard('{Enter}')
    expect(h.updateGroupName).not.toHaveBeenCalled()
    expect(h.toastInfo).toHaveBeenCalledWith(expect.any(String), { id: 'groups-changed-elsewhere' })
    expect(onClose).toHaveBeenCalled()
  })

  it('typing the current name closes without a write (no empty undo step)', async () => {
    const { user, onClose } = renderModal()
    await user.type(customBox(), 'Google')
    await user.click(renameButton())
    expect(h.updateGroupName).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('a failed write toasts and keeps the picker open', async () => {
    h.updateGroupName.mockRejectedValue(new Error('idb down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { user, onClose } = renderModal()
    await user.click(renameButton())
    expect(h.toastError).toHaveBeenCalledWith('Could not rename the group')
    expect(onClose).not.toHaveBeenCalled()
    expect(renameButton()).toBeEnabled()
  })

  it('Cancel closes without writing', async () => {
    const { user, onClose } = renderModal()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(h.updateGroupName).not.toHaveBeenCalled()
  })
})

describe('NameGroupPickerModal — keyboard', () => {
  it('ArrowDown and ArrowUp move between the options, wrapping, and into and out of the box', async () => {
    const { user } = renderModal()
    await waitFor(() => expect(radio('BC Election Coverage')).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    expect(radio('Local News')).toBeChecked()
    expect(radio('Local News')).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    // The last option is "your own": focus goes to its box
    expect(customRadio()).toBeChecked()
    expect(customBox()).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(radio('BC Election Coverage')).toBeChecked()
    expect(radio('BC Election Coverage')).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(customBox()).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(radio('Election Night')).toBeChecked()
    expect(radio('Election Night')).toHaveFocus()
  })

  it('ArrowRight and ArrowLeft move between the radios (the reading direction), and leave the caret alone in the box', async () => {
    const { user } = renderModal()
    await waitFor(() => expect(radio('BC Election Coverage')).toHaveFocus())
    await user.keyboard('{ArrowRight}')
    expect(radio('Local News')).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(radio('BC Election Coverage')).toHaveFocus()
    await user.click(customBox())
    await user.keyboard('ab{ArrowLeft}c')
    expect(customBox()).toHaveValue('acb')
    expect(customBox()).toHaveFocus()
  })

  it('in a right-to-left layout ArrowLeft moves forward', async () => {
    document.documentElement.dir = 'rtl'
    try {
      const { user } = renderModal()
      await waitFor(() => expect(radio('BC Election Coverage')).toHaveFocus())
      await user.keyboard('{ArrowLeft}')
      expect(radio('Local News')).toHaveFocus()
      await user.keyboard('{ArrowRight}')
      expect(radio('BC Election Coverage')).toHaveFocus()
    } finally {
      document.documentElement.dir = ''
    }
  })

  it('Enter on an option renames to it', async () => {
    const { user, onClose } = renderModal()
    await waitFor(() => expect(radio('BC Election Coverage')).toHaveFocus())
    await user.keyboard('{ArrowDown}{Enter}')
    expect(h.updateGroupName).toHaveBeenCalledTimes(1)
    expect(h.updateGroupName).toHaveBeenCalledWith({ groupIndex: 1, name: 'Local News' })
    expect(onClose).toHaveBeenCalled()
  })

  it('Enter in the box renames to the typed name', async () => {
    const { user } = renderModal()
    await user.click(customBox())
    await user.keyboard('Votes{Enter}')
    expect(h.updateGroupName).toHaveBeenCalledTimes(1)
    expect(h.updateGroupName).toHaveBeenCalledWith({ groupIndex: 1, name: 'Votes' })
  })

  it('Enter on Cancel cancels (the button\'s own click), never renames', async () => {
    const { user, onClose } = renderModal()
    screen.getByRole('button', { name: 'Cancel' }).focus()
    await user.keyboard('{Enter}')
    expect(onClose).toHaveBeenCalled()
    expect(h.updateGroupName).not.toHaveBeenCalled()
  })

  it('Escape cancels without writing', async () => {
    const { user, onClose } = renderModal()
    await waitFor(() => expect(radio('BC Election Coverage')).toHaveFocus())
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    expect(h.updateGroupName).not.toHaveBeenCalled()
  })
})
