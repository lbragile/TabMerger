import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { DeleteConfirmModal } from '@/components/Modal/DeleteConfirm'

function renderModal(ui: React.ReactElement) {
  return render(<Dialog open><DialogContent>{ui}</DialogContent></Dialog>)
}

/** The dialog's built-in X-close button also has accessible name "Close" — disambiguate by the destructive variant class. */
function getDestructiveButton(name: RegExp) {
  return screen.getAllByRole('button', { name }).find((b) => b.className.includes('destructive'))!
}

const { mockDeleteGroup, mockDeleteWindow, mockDeleteTab, mockBulkDelete } = vi.hoisted(() => ({
  mockDeleteGroup: vi.fn(),
  mockDeleteWindow: vi.fn(),
  mockDeleteTab: vi.fn(),
  mockBulkDelete: vi.fn(),
}))

vi.mock('@/hooks/useGroups', () => ({
  useDeleteGroup: () => ({ mutate: mockDeleteGroup }),
  useDeleteWindow: () => ({ mutate: mockDeleteWindow }),
  useDeleteTab: () => ({ mutate: mockDeleteTab }),
}))

vi.mock('@/hooks/useBulkActions', () => ({
  useBulkDelete: () => ({ mutate: mockBulkDelete }),
}))

beforeEach(() => vi.clearAllMocks())

describe('DeleteConfirmModal — deleteGroup', () => {
  it('confirms deletion of a group by index', () => {
    const onClose = vi.fn()
    renderModal(<DeleteConfirmModal type="deleteGroup" data={{ groupIndex: 2, groupName: 'Work' }} onClose={onClose} />)
    expect(screen.getByText('Delete Group')).toBeTruthy()
    expect(screen.getByText(/Work/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(mockDeleteGroup).toHaveBeenCalledWith(2)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('DeleteConfirmModal — deleteWindow', () => {
  it('labels as "Close Window" when isNowOpen is true', () => {
    renderModal(<DeleteConfirmModal type="deleteWindow" data={{ isNowOpen: true, groupIndex: 0, windowIndex: 1 }} onClose={vi.fn()} />)
    expect(screen.getByText('Close Window')).toBeTruthy()
    fireEvent.click(getDestructiveButton(/^close$/i))
    expect(mockDeleteWindow).toHaveBeenCalledWith({ groupIndex: 0, windowIndex: 1 })
  })

  it('labels as "Remove Window" when not Now Open', () => {
    renderModal(<DeleteConfirmModal type="deleteWindow" data={{ isNowOpen: false, groupIndex: 0, windowIndex: 1 }} onClose={vi.fn()} />)
    expect(screen.getByText('Remove Window')).toBeTruthy()
  })
})

describe('DeleteConfirmModal — deleteTab', () => {
  it('deletes a tab by position', () => {
    renderModal(<DeleteConfirmModal type="deleteTab" data={{ isNowOpen: false, groupIndex: 0, windowIndex: 1, tabIndex: 2 }} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(mockDeleteTab).toHaveBeenCalledWith({ groupIndex: 0, windowIndex: 1, tabIndex: 2 })
  })
})

describe('DeleteConfirmModal — deleteSelection (bulk)', () => {
  it('routes bulk deletion through useBulkDelete with the same items', () => {
    const items = [{ type: 'tab', groupIndex: 0, windowIndex: 0, tabIndex: 0 }, { type: 'tab', groupIndex: 0, windowIndex: 0, tabIndex: 1 }]
    renderModal(<DeleteConfirmModal type="deleteSelection" data={{ isNowOpen: false, items }} onClose={vi.fn()} />)
    expect(screen.getByText(/2 tabs/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(mockBulkDelete).toHaveBeenCalledWith(items)
  })

  it('uses "close" verbiage for Now Open bulk selection', () => {
    const items = [{ type: 'tab', groupIndex: 0, windowIndex: 0, tabIndex: 0 }]
    renderModal(<DeleteConfirmModal type="deleteSelection" data={{ isNowOpen: true, items }} onClose={vi.fn()} />)
    expect(screen.getByText('Close Selection')).toBeTruthy()
    fireEvent.click(getDestructiveButton(/^close$/i))
    expect(mockBulkDelete).toHaveBeenCalledWith(items)
  })
})

describe('DeleteConfirmModal — clearAllData', () => {
  it('warns the action is destructive/irreversible and invokes onConfirm only when confirmed', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    renderModal(<DeleteConfirmModal type="clearAllData" data={{ onConfirm }} onClose={onClose} />)
    expect(screen.getByRole('heading', { name: 'Clear All Data' })).toBeTruthy()
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy()
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(getDestructiveButton(/clear all data/i))
    expect(onConfirm).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onConfirm when Cancel is clicked', () => {
    const onConfirm = vi.fn()
    renderModal(<DeleteConfirmModal type="clearAllData" data={{ onConfirm }} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('DeleteConfirmModal — resetEncryption', () => {
  it('warns the action is destructive/irreversible and invokes onConfirm only when confirmed', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    renderModal(<DeleteConfirmModal type="resetEncryption" data={{ onConfirm }} onClose={onClose} />)
    expect(screen.getByRole('heading', { name: 'Reset Encryption Passphrase' })).toBeTruthy()
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy()
    expect(screen.getByText(/permanently inaccessible/i)).toBeTruthy()
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(getDestructiveButton(/reset passphrase/i))
    expect(onConfirm).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onConfirm when Cancel is clicked', () => {
    const onConfirm = vi.fn()
    renderModal(<DeleteConfirmModal type="resetEncryption" data={{ onConfirm }} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
