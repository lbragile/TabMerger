import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ShortcutSavePickerModal } from '@/components/Modal/ShortcutSavePicker'

function renderModal(ui: React.ReactElement) {
  return render(<Dialog open><DialogContent>{ui}</DialogContent></Dialog>)
}

const { mockUseGroups, mockSaveTabs } = vi.hoisted(() => ({
  mockUseGroups: vi.fn(),
  mockSaveTabs: vi.fn(),
}))

vi.mock('@/hooks/useGroups', () => ({
  useGroups: mockUseGroups,
  useSaveShortcutTabs: () => ({ mutate: mockSaveTabs, isPending: false }),
}))

const groupsState = {
  available: [
    { id: 'now', permanent: true, windows: [], name: 'Now Open' },
    { id: 'g1', permanent: false, windows: [], name: 'Work' },
    { id: 'g2', permanent: false, archived: true, windows: [], name: 'Old' },
  ],
}
const tabs = [{ id: 1, title: 'A', url: 'https://a.com' }]

beforeEach(() => {
  vi.clearAllMocks()
  mockUseGroups.mockReturnValue({ data: groupsState })
  globalThis.chrome = {
    storage: { session: { remove: vi.fn() } },
  } as unknown as typeof chrome
})

describe('ShortcutSavePickerModal', () => {
  it('excludes permanent and archived groups from the dropdown', () => {
    renderModal(<ShortcutSavePickerModal data={{ tabs }} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getAllByText('Work').length).toBeGreaterThan(0)
    expect(screen.getByText('Quick Save (new group)')).toBeTruthy()
    expect(screen.queryByText('Now Open')).toBeNull()
    expect(screen.queryByText('Old')).toBeNull()
  })

  it('defaults selection to the first non-permanent group and saves into it on confirm', () => {
    const onClose = vi.fn()
    renderModal(<ShortcutSavePickerModal data={{ tabs }} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(mockSaveTabs).toHaveBeenCalledWith({ tabs, groupId: 'g1' })
    expect(chrome.storage.session.remove).toHaveBeenCalledWith('pendingShortcutSave')
    expect(onClose).toHaveBeenCalled()
  })

  it('saves into a new group when "Quick Save (new group)" is chosen', () => {
    renderModal(<ShortcutSavePickerModal data={{ tabs }} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByText('Quick Save (new group)'))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(mockSaveTabs).toHaveBeenCalledWith({ tabs, groupId: undefined })
  })

  it('cancel clears the pending session state without saving', () => {
    const onClose = vi.fn()
    renderModal(<ShortcutSavePickerModal data={{ tabs }} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockSaveTabs).not.toHaveBeenCalled()
    expect(chrome.storage.session.remove).toHaveBeenCalledWith('pendingShortcutSave')
    expect(onClose).toHaveBeenCalled()
  })
})
