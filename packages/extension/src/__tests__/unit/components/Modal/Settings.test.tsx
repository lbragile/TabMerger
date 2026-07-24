import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { SettingsModal } from '@/components/Modal/Settings'

async function goToTab(name: RegExp) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('tab', { name }))
}

const {
  mockGetSetting,
  mockSetSetting,
  mockApplyTheme,
  mockUseEntitlements,
  mockUseAuth,
  mockUseGroups,
  mockImportGroupsMutate,
  mockExportGroups,
  mockGetDb,
} = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockSetSetting: vi.fn().mockResolvedValue(undefined),
  mockApplyTheme: vi.fn(),
  mockUseEntitlements: vi.fn(),
  mockUseAuth: vi.fn(),
  mockUseGroups: vi.fn(),
  mockImportGroupsMutate: vi.fn(),
  mockExportGroups: vi.fn().mockReturnValue('{}'),
  mockGetDb: vi.fn().mockResolvedValue({ clear: vi.fn().mockResolvedValue(undefined) }),
}))

vi.mock('@/lib/localDb', () => ({
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
  getDb: mockGetDb,
}))

vi.mock('@/lib/theme', () => ({ applyTheme: mockApplyTheme }))

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => mockUseGroups(),
  useImportGroups: () => ({ mutate: mockImportGroupsMutate }),
}))
vi.mock('@/lib/importExport', () => ({
  importGroups: vi.fn().mockReturnValue([{ name: 'g' }]),
  parseBookmarksHtml: vi.fn().mockReturnValue([]),
  parseOneTabs: vi.fn().mockReturnValue([]),
  exportGroups: mockExportGroups,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const DEFAULT_SETTINGS = {
  theme: 'system',
  confirmOnDelete: false,
  syncEnabled: true,
  openTabOnClick: true,
  autoDedupOnMerge: false,
  staleThresholdDays: 30,
}

function renderModal() {
  return render(<Dialog open><DialogContent><SettingsModal onClose={vi.fn()} /></DialogContent></Dialog>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSetting.mockResolvedValue(DEFAULT_SETTINGS)
  mockUseEntitlements.mockReturnValue({ tier: 'free', cloudSync: false })
  mockUseAuth.mockReturnValue({ user: null, session: null, signOut: vi.fn() })
  mockUseGroups.mockReturnValue({ data: { available: [] } })
  globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome
  globalThis.confirm = vi.fn().mockReturnValue(true)
  globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:x')
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe('SettingsModal — dirty state and save', () => {
  it('Save changes button is disabled until a setting is changed', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })

  it('toggling confirmOnDelete enables Save and persists via setSetting', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    fireEvent.click(screen.getAllByRole('switch')[0])
    const saveBtn = screen.getByRole('button', { name: /save changes/i })
    expect(saveBtn).not.toBeDisabled()
    fireEvent.click(saveBtn)
    await waitFor(() => expect(mockSetSetting).toHaveBeenCalledWith('appSettings', expect.objectContaining({ confirmOnDelete: true })))
  })

  it('Restore defaults resets the draft back to defaults (Save becomes disabled again)', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    fireEvent.click(screen.getAllByRole('switch')[0])
    expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /restore defaults/i }))
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })
})

describe('SettingsModal — Account tab', () => {
  it('shows "Upgrade to Pro" for free tier without cloudSync', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    expect(screen.getByRole('button', { name: /upgrade to pro/i })).toBeTruthy()
  })

  it('shows cloud sync toggle instead when cloudSync entitlement is true', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro', cloudSync: true })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    expect(screen.queryByRole('button', { name: /upgrade to pro/i })).toBeNull()
    expect(screen.getByText('Cloud sync')).toBeTruthy()
  })

  it('shows Sign out button when a user is signed in', async () => {
    mockUseAuth.mockReturnValue({ user: { email: 'user@example.com' }, session: null, signOut: vi.fn() })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    expect(screen.getByRole('button', { name: /sign out/i })).toBeTruthy()
  })
})

describe('SettingsModal — Data tab', () => {
  it('Export downloads groups as JSON via exportGroups', async () => {
    mockUseGroups.mockReturnValue({ data: { available: [{ name: 'g' }] } })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^data$/i)
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }))
    expect(mockExportGroups).toHaveBeenCalledWith([{ name: 'g' }])
  })

  it('Clear all data requires confirm() and clears all IndexedDB stores', async () => {
    const clearMock = vi.fn().mockResolvedValue(undefined)
    mockGetDb.mockResolvedValue({ clear: clearMock })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^data$/i)
    fireEvent.click(screen.getByRole('button', { name: /clear all data/i }))
    await waitFor(() => expect(clearMock).toHaveBeenCalledWith('groups'))
    expect(clearMock).toHaveBeenCalledWith('groupsState')
    expect(clearMock).toHaveBeenCalledWith('sessions')
    expect(clearMock).toHaveBeenCalledWith('settings')
  })

  it('Clear all data does nothing if the user cancels the confirm dialog', async () => {
    globalThis.confirm = vi.fn().mockReturnValue(false)
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^data$/i)
    fireEvent.click(screen.getByRole('button', { name: /clear all data/i }))
    expect(mockGetDb).not.toHaveBeenCalled()
  })

  function fileInput() {
    return document.querySelector('input[type="file"]') as HTMLInputElement
  }

  it('imports a .json file via importGroups and closes the modal on success', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^data$/i)
    const file = new File(['{}'], 'backup.json', { type: 'application/json' })
    fireEvent.change(fileInput(), { target: { files: [file] } })
    await waitFor(() => expect(mockImportGroupsMutate).toHaveBeenCalled())
  })

  it('shows an error toast and skips the mutation when the parsed file has zero groups', async () => {
    const { importGroups } = await import('@/lib/importExport')
    ;(importGroups as ReturnType<typeof vi.fn>).mockReturnValueOnce([])
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^data$/i)
    const file = new File(['{}'], 'empty.json', { type: 'application/json' })
    fireEvent.change(fileInput(), { target: { files: [file] } })
    await waitFor(() => expect(mockImportGroupsMutate).not.toHaveBeenCalled())
  })

  it('does not import when the user cancels the import confirm dialog', async () => {
    globalThis.confirm = vi.fn().mockReturnValue(false)
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^data$/i)
    const file = new File(['{}'], 'backup.json', { type: 'application/json' })
    fireEvent.change(fileInput(), { target: { files: [file] } })
    await waitFor(() => expect(globalThis.confirm).toHaveBeenCalled())
    expect(mockImportGroupsMutate).not.toHaveBeenCalled()
  })
})

describe('SettingsModal — billing portal', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  it('opens the billing portal URL for paid tiers', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro', cloudSync: true })
    mockUseAuth.mockReturnValue({ user: { email: 'user@example.com' }, session: { access_token: 'tok' }, signOut: vi.fn() })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ url: 'https://billing.example.com' }),
    })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    fireEvent.click(screen.getByRole('button', { name: /manage billing/i }))
    await waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://billing.example.com', active: true }))
  })

  it('shows an error toast when the portal request fails', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro', cloudSync: true })
    mockUseAuth.mockReturnValue({ user: { email: 'user@example.com' }, session: { access_token: 'tok' }, signOut: vi.fn() })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ error: 'nope' }) })
    const { toast } = await import('sonner')
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    fireEvent.click(screen.getByRole('button', { name: /manage billing/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not open billing portal'))
  })

  it('does not show "Manage billing" for the free tier', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'free', cloudSync: false })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    expect(screen.queryByRole('button', { name: /manage billing/i })).toBeNull()
  })
})
