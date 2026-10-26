import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { DescribeGroupReviewModal } from '@/components/Modal/DescribeGroupReview'
import { windowTabsKey } from '@/lib/aiTarget'
import type { Group } from '@/lib/types'

/**
 * The "Describe group" review for a group that already has a note: Replace note, Add below (note,
 * blank line, suggestion; only while it fits the 500-character note limit) and Cancel.
 */

const h = vi.hoisted(() => ({
  groups: [] as Group[],
  saveNote: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/hooks/useGroups', () => ({ useGroups: () => ({ data: { active: { id: '', index: 0 }, available: h.groups } }) }))
vi.mock('@/hooks/useDescribeGroupAction', () => ({ useSaveNote: () => h.saveNote }))
vi.mock('@/lib/toast', () => ({ toast: { error: h.toastError } }))

function group(note: string): Group {
  return { id: 'g1', name: 'Research', color: 'rgba(0,0,0,1)', updatedAt: 1, windows: [], note }
}

function renderModal(data: Record<string, unknown> = { groupId: 'g1', description: 'Docs and specs.' }) {
  const onClose = vi.fn()
  render(
    React.createElement(Dialog, { open: true },
      React.createElement(DialogContent, null, React.createElement(DescribeGroupReviewModal, { data, onClose }))
    )
  )
  return { onClose, user: userEvent.setup() }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.groups = [group('My own words')]
  h.saveNote.mockResolvedValue(true)
})

describe('DescribeGroupReviewModal', () => {
  it('shows the current note and the suggestion, with the three choices', () => {
    renderModal()
    expect(screen.getByRole('dialog', { name: 'Use the AI description?' })).toBeTruthy()
    expect(screen.getByTestId('describe-group-current-note')).toHaveTextContent('My own words')
    expect(screen.getByTestId('describe-group-suggestion')).toHaveTextContent('Docs and specs.')
    for (const name of ['Cancel', 'Add below', 'Replace note']) expect(screen.getByRole('button', { name })).toBeEnabled()
  })

  it('Replace note writes the suggestion as the whole note and closes', async () => {
    const { user, onClose } = renderModal()
    await user.click(screen.getByRole('button', { name: 'Replace note' }))
    expect(h.saveNote).toHaveBeenCalledWith({ kind: 'group', groupId: 'g1' }, 'Docs and specs.', 'Note replaced')
    expect(onClose).toHaveBeenCalled()
  })

  it('Add below keeps the note, then a blank line, then the suggestion', async () => {
    h.groups = [group('My own words  \n')]
    const { user, onClose } = renderModal()
    await user.click(screen.getByRole('button', { name: 'Add below' }))
    expect(h.saveNote).toHaveBeenCalledWith({ kind: 'group', groupId: 'g1' }, 'My own words\n\nDocs and specs.', 'Note added')
    expect(onClose).toHaveBeenCalled()
  })

  it('Cancel closes without writing', async () => {
    const { user, onClose } = renderModal()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(h.saveNote).not.toHaveBeenCalled()
  })

  it('Add below is disabled with a hint when the result would pass the 500-character note limit', () => {
    h.groups = [group('n'.repeat(400))]
    renderModal({ groupId: 'g1', description: 'd'.repeat(120) })
    expect(screen.getByRole('button', { name: 'Add below' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Replace note' })).toBeEnabled()
    expect(screen.getByText(/at most 500 characters/)).toBeTruthy()
  })

  it('a group that is gone disables both writes', () => {
    h.groups = []
    renderModal()
    expect(screen.getByRole('button', { name: 'Add below' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Replace note' })).toBeDisabled()
  })

  it('renders long text as text, wrapping (never markup)', () => {
    renderModal({ groupId: 'g1', description: '<img src=x onerror=alert(1)>' })
    const box = screen.getByTestId('describe-group-suggestion')
    expect(box.querySelector('img')).toBeNull()
    expect(box.className).toContain('break-words')
    expect(box.className).toContain('min-w-0')
  })

  it('a failed write keeps the modal open and toasts', async () => {
    h.saveNote.mockRejectedValue(new Error('idb'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { user, onClose } = renderModal()
    await user.click(screen.getByRole('button', { name: 'Replace note' }))
    expect(h.toastError).toHaveBeenCalledWith('Could not save the note')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Replace note' })).toBeEnabled()
  })

  it('malformed data shows an empty suggestion and cannot replace', () => {
    renderModal({ groupId: 5, description: null })
    expect(screen.getByRole('button', { name: 'Replace note' })).toBeDisabled()
  })
})

describe('DescribeGroupReviewModal — a window', () => {
  const tab = (title: string) => ({ id: 0, title, url: `https://${title.toLowerCase()}.example.com` })
  const win = (note: string, tabs = [tab('A'), tab('B')]) => ({ id: 0, tabs, incognito: false, focused: false, name: 'Reading', note })
  const target = { index: 1, tabsKey: windowTabsKey(win('')) }
  const windowTarget = { kind: 'window', groupId: 'g1', windowIndex: 1, tabsKey: target.tabsKey }

  beforeEach(() => {
    h.groups = [{ ...group('Group note'), windows: [win('', [tab('Other')]), win('Window note')] }]
  })

  it('shows the WINDOW note (not the group note) and says it is the window that has one', () => {
    renderModal({ groupId: 'g1', window: target, description: 'Docs and specs.' })
    expect(screen.getByTestId('describe-group-current-note')).toHaveTextContent('Window note')
    expect(screen.getByText('This window already has a note. Replace it, or add the suggestion below it.')).toBeTruthy()
  })

  it('Replace note writes to the window target', async () => {
    const { user, onClose } = renderModal({ groupId: 'g1', window: target, description: 'Docs and specs.' })
    await user.click(screen.getByRole('button', { name: 'Replace note' }))
    expect(h.saveNote).toHaveBeenCalledWith(windowTarget, 'Docs and specs.', 'Note replaced')
    expect(onClose).toHaveBeenCalled()
  })

  it('Add below appends to the window note', async () => {
    const { user } = renderModal({ groupId: 'g1', window: target, description: 'Docs and specs.' })
    await user.click(screen.getByRole('button', { name: 'Add below' }))
    expect(h.saveNote).toHaveBeenCalledWith(windowTarget, 'Window note\n\nDocs and specs.', 'Note added')
  })

  it('Cancel writes nothing', async () => {
    const { user, onClose } = renderModal({ groupId: 'g1', window: target, description: 'Docs and specs.' })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(h.saveNote).not.toHaveBeenCalled()
  })

  it('Add below is disabled past the 500-character window note limit', () => {
    h.groups = [{ ...group(''), windows: [win('', [tab('Other')]), win('n'.repeat(450))] }]
    renderModal({ groupId: 'g1', window: target, description: 'd'.repeat(60) })
    expect(screen.getByRole('button', { name: 'Add below' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Replace note' })).toBeEnabled()
    expect(screen.getByText(/at most 500 characters/)).toBeTruthy()
  })

  it('a window that is gone or now holds other tabs disables both writes', () => {
    h.groups = [{ ...group(''), windows: [win('x', [tab('Other')])] }]
    renderModal({ groupId: 'g1', window: target, description: 'Docs and specs.' })
    expect(screen.getByRole('button', { name: 'Add below' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Replace note' })).toBeDisabled()
  })

  it.each([['not an object', 'x'], ['a negative index', { index: -1, tabsKey: '[]' }], ['no tabs key', { index: 0 }]])(
    'malformed window data (%s) is never read as the whole group',
    (_label, window) => {
      renderModal({ groupId: 'g1', window, description: 'Docs and specs.' })
      expect(screen.getByRole('button', { name: 'Replace note' })).toBeDisabled()
    }
  )
})
