import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
  mockOpenModal,
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
  mockOpenModal: vi.fn(),
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
vi.mock('@/stores/uiStore', () => ({ useUIStore: (sel: (s: { openModal: typeof mockOpenModal }) => unknown) => sel({ openModal: mockOpenModal }) }))

const DEFAULT_SETTINGS = {
  theme: 'system',
  confirmOnDelete: false,
  syncEnabled: true,
  openTabOnClick: true,
  autoDedupOnMerge: false,
  staleThresholdDays: 30,
}

function renderModal(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Dialog open><DialogContent><SettingsModal onClose={onClose} /></DialogContent></Dialog>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSetting.mockResolvedValue(DEFAULT_SETTINGS)
  mockUseEntitlements.mockReturnValue({ tier: 'free', cloudSync: false })
  mockUseAuth.mockReturnValue({ user: null, session: null, signOut: vi.fn() })
  mockUseGroups.mockReturnValue({ data: { available: [] } })
  globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome
  globalThis.confirm = vi.fn().mockReturnValue(true) // still used by the Import flow's confirm()
  globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:x')
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe('SettingsModal — reactive settings (regression)', () => {
  it('reflects a setting saved elsewhere in the same popup session without remounting (shared appSettings query)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <Dialog open><DialogContent><SettingsModal onClose={vi.fn()} /></DialogContent></Dialog>
      </QueryClientProvider>
    )
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(screen.getAllByRole('switch')[0]).not.toBeChecked()

    // Simulate another part of the app (or another mount of this modal) saving confirmOnDelete: true
    // and invalidating the shared query — this modal should pick it up without being reopened.
    mockGetSetting.mockResolvedValue({ ...DEFAULT_SETTINGS, confirmOnDelete: true })
    await qc.invalidateQueries({ queryKey: ['appSettings'] })

    await waitFor(() => expect(screen.getAllByRole('switch')[0]).toBeChecked())
  })

  it('refetches the correct persisted settings after the appSettings query is invalidated on login (regression)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mockGetSetting.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, autoDedupOnMerge: false })
    render(
      <QueryClientProvider client={qc}>
        <Dialog open><DialogContent><SettingsModal onClose={vi.fn()} /></DialogContent></Dialog>
      </QueryClientProvider>
    )
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(screen.getAllByRole('switch')[2]).not.toBeChecked()

    // Simulate useSync's post-login invalidate (see hooks/useSync.ts) picking up the
    // authoritative IndexedDB value once a session appears.
    mockGetSetting.mockResolvedValue({ ...DEFAULT_SETTINGS, autoDedupOnMerge: true })
    await qc.invalidateQueries({ queryKey: ['appSettings'] })

    await waitFor(() => expect(screen.getAllByRole('switch')[2]).toBeChecked())
  })
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

describe('SettingsModal — General tab cloud sync', () => {
  it('does not show cloud sync toggle when cloudSync entitlement is false', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(screen.queryByText('Cloud sync')).toBeNull()
  })

  it('shows cloud sync toggle in the General tab when cloudSync entitlement is true', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro', cloudSync: true })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(screen.getByText('Cloud sync')).toBeTruthy()
  })
})

describe('SettingsModal — footer visibility', () => {
  it('shows the Save/Restore footer on the General tab', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /save changes/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /restore defaults/i })).toBeTruthy()
  })

  it('hides the Save/Restore footer on the Account tab', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /restore defaults/i })).toBeNull()
  })

  it('hides the Save/Restore footer on the Data tab', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^data$/i)
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /restore defaults/i })).toBeNull()
  })
})

describe('SettingsModal — Account tab', () => {
  it('shows "Upgrade to Pro" for free tier without cloudSync', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    expect(screen.getByRole('button', { name: /upgrade to pro/i })).toBeTruthy()
  })

  it('does not show cloud sync toggle in Account tab even when cloudSync entitlement is true', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro', cloudSync: true })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    expect(screen.queryByRole('button', { name: /upgrade to pro/i })).toBeNull()
    expect(screen.queryByText('Cloud sync')).toBeNull()
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

  it('Clear all data opens the clearAllData confirm modal instead of window.confirm()', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^data$/i)
    fireEvent.click(screen.getByRole('button', { name: /clear all data/i }))
    expect(mockOpenModal).toHaveBeenCalledWith('clearAllData', { onConfirm: expect.any(Function) })
    expect(mockGetDb).not.toHaveBeenCalled()
  })

  it('confirming the clearAllData modal clears all IndexedDB stores', async () => {
    const clearMock = vi.fn().mockResolvedValue(undefined)
    mockGetDb.mockResolvedValue({ clear: clearMock })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^data$/i)
    fireEvent.click(screen.getByRole('button', { name: /clear all data/i }))
    const onConfirm = mockOpenModal.mock.calls[0][1].onConfirm as () => void
    onConfirm()
    await waitFor(() => expect(clearMock).toHaveBeenCalledWith('groups'))
    expect(clearMock).toHaveBeenCalledWith('groupsState')
    expect(clearMock).toHaveBeenCalledWith('sessions')
    expect(clearMock).toHaveBeenCalledWith('settings')
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
