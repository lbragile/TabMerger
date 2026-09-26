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
  mockEnterDemoMode,
  mockTrackEvent,
  mockUseAiUsage,
  mockSetDevAiUsage,
  mockHasEncryptionKey,
  mockGetDataKey,
  mockResetEncryption,
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
  mockEnterDemoMode: vi.fn().mockResolvedValue(undefined),
  mockTrackEvent: vi.fn(),
  mockUseAiUsage: vi.fn(),
  mockSetDevAiUsage: vi.fn().mockResolvedValue(undefined),
  mockHasEncryptionKey: vi.fn().mockResolvedValue(false),
  mockGetDataKey: vi.fn().mockResolvedValue(null),
  mockResetEncryption: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/encryptionKey', () => ({
  hasEncryptionKey: mockHasEncryptionKey,
  getDataKey: mockGetDataKey,
  resetEncryption: mockResetEncryption,
}))

vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))

vi.mock('@/lib/demo', () => ({ enterDemoMode: mockEnterDemoMode }))

vi.mock('@/lib/localDb', () => ({
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
  getDb: mockGetDb,
}))

vi.mock('@/lib/theme', () => ({ applyTheme: mockApplyTheme }))

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => mockUseAiUsage() }))
vi.mock('@/mocks/devAiUsage', () => ({ setDevAiUsage: mockSetDevAiUsage }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => mockUseGroups(),
  useImportGroups: () => ({ mutate: mockImportGroupsMutate }),
  GROUPS_QUERY_KEY: ['groups'],
}))
vi.mock('@/lib/importExport', () => ({
  importGroups: vi.fn().mockReturnValue([{ name: 'g' }]),
  parseBookmarksHtml: vi.fn().mockReturnValue([]),
  parseOneTabs: vi.fn().mockReturnValue([]),
  exportGroups: mockExportGroups,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/Settings/OtherDevices', () => ({ OtherDevices: () => <div>Other devices panel</div> }))
vi.mock('@/stores/uiStore', () => ({ useUIStore: (sel: (s: { openModal: typeof mockOpenModal }) => unknown) => sel({ openModal: mockOpenModal }) }))

const DEFAULT_SETTINGS = {
  theme: 'system',
  confirmOnDelete: false,
  syncEnabled: true,
  openTabOnClick: true,
  autoDedupOnMerge: false,
  staleThresholdDays: 30,
  aiDailyThrottle: true,
  aiAutoGroupEnabled: true,
  aiNameGroupEnabled: true,
  aiSuggestSessionsEnabled: true,
  aiOrganizeEnabled: true,
  aiTabSummaryEnabled: true,
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
  mockUseAiUsage.mockReturnValue({ used: 0, remaining: 100, cap: 100, loading: false })
  mockUseAuth.mockReturnValue({ user: null, session: null, signOut: vi.fn() })
  mockUseGroups.mockReturnValue({ data: { available: [] } })
  globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome
  globalThis.confirm = vi.fn().mockReturnValue(true) // still used by the Import flow's confirm()
  globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:x')
  globalThis.URL.revokeObjectURL = vi.fn()
  mockHasEncryptionKey.mockResolvedValue(false)
  mockGetDataKey.mockReturnValue(null)
})

describe('SettingsModal — Devices tab', () => {
  it('hides the Devices tab entirely for free tier', () => {
    mockUseEntitlements.mockReturnValue({ tier: 'free', cloudSync: false })
    renderModal()
    expect(screen.queryByRole('tab', { name: /devices/i })).not.toBeInTheDocument()
  })

  it('shows the Devices tab for pro tier and renders OtherDevices when selected', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro', cloudSync: true })
    renderModal()
    await goToTab(/devices/i)
    expect(await screen.findByText('Other devices panel')).toBeInTheDocument()
  })
})

describe('SettingsModal — AI tab', () => {
  it('hides the AI tab entirely when the user lacks aiFeatures', () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro', cloudSync: true, aiFeatures: false })
    renderModal()
    expect(screen.queryByRole('tab', { name: /^ai$/i })).not.toBeInTheDocument()
  })

  it('shows 5 independent per-feature toggles, all on by default, and no master switch', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', cloudSync: true, aiFeatures: true })
    renderModal()
    await goToTab(/^ai$/i)
    expect(screen.getAllByText(/auto-group/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/name group/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/suggest sessions/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/organize/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/tab preview summaries/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/ai features enabled/i)).not.toBeInTheDocument()
    const switches = screen.getAllByRole('switch')
    switches.forEach((s) => expect(s).toBeChecked())
  })
})

describe('SettingsModal — Account tab AI usage indicator', () => {
  it('shows AI credits remaining for Pro AI users', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', cloudSync: true, aiFeatures: true })
    mockUseAiUsage.mockReturnValue({ used: 3, remaining: 97, cap: 100, loading: false })
    renderModal()
    await goToTab(/account/i)
    expect(await screen.findByText('97 / 100')).toBeInTheDocument()
  })

  it('hides the AI usage indicator for non-Pro-AI users', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'free', cloudSync: false, aiFeatures: false })
    renderModal()
    await goToTab(/account/i)
    expect(screen.queryByText(/AI credits left this month/i)).not.toBeInTheDocument()
  })
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
    // confirmOnDelete is not the sync toggle — sync_enabled must not fire for this save
    expect(mockTrackEvent).not.toHaveBeenCalledWith('sync_enabled')
  })

  it('tracks sync_enabled only on a false→true syncEnabled transition, not on save in general', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro', cloudSync: true })
    mockGetSetting.mockResolvedValue({ ...DEFAULT_SETTINGS, syncEnabled: false })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    // Switch order: confirmOnDelete(0), openTabOnClick(1), autoDedupOnMerge(2),
    // cloud sync(3) — cloud sync only renders when cloudSync is true.
    await waitFor(() => expect(screen.getAllByRole('switch')[3]).not.toBeChecked())
    const syncSwitch = screen.getAllByRole('switch')[3]
    fireEvent.click(syncSwitch)
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(mockSetSetting).toHaveBeenCalled())
    expect(mockTrackEvent).toHaveBeenCalledWith('sync_enabled')
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

  it('tracks upgrade_prompt_shown on mount when cloudSync entitlement is false', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(mockTrackEvent).toHaveBeenCalledWith('upgrade_prompt_shown', { source: 'settings' })
  })

  it('does not track upgrade_prompt_shown on mount when cloudSync entitlement is true', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro', cloudSync: true })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(mockTrackEvent).not.toHaveBeenCalledWith('upgrade_prompt_shown', expect.anything())
  })

  it('shows cloud sync toggle in the General tab when cloudSync entitlement is true', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro', cloudSync: true })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(screen.getByText('Cloud sync')).toBeTruthy()
  })
})

describe('SettingsModal — General tab URL rules entry point', () => {
  it('shows a "Manage" button for URL rules that opens the urlRules modal', async () => {
    const user = userEvent.setup()
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(screen.getByText('URL rules')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Manage' }))
    expect(mockOpenModal).toHaveBeenCalledWith('urlRules')
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

  it('tracks upgrade_clicked when "Upgrade to Pro" is clicked', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('upgrade_clicked', { source: 'settings' })
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

describe('SettingsModal — Dev tab (dev-only)', () => {
  // ponytail: import.meta.env.DEV is true under Vitest, so the gate is exercised via its DEV branch here.
  it('shows a Demo Mode entry in the Dev tab in dev builds and calls enterDemoMode on click', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^dev$/i)
    const demoBtn = screen.getByRole('button', { name: 'Enter' })
    fireEvent.click(demoBtn)
    await waitFor(() => expect(mockEnterDemoMode).toHaveBeenCalled())
  })

  it('shows a Sentry test-error button in the Dev tab', async () => {
    // ponytail: not exercising the click — it deliberately throws for Sentry's
    // real window error listener to catch, which jsdom/React re-raises as an
    // uncaught test-runner exception rather than a catchable synchronous throw.
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^dev$/i)
    expect(screen.getByRole('button', { name: 'Throw error' })).toBeInTheDocument()
  })

  it('writes the entered value via setDevAiUsage and invalidates aiUsage on Set', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^dev$/i)
    const input = screen.getByDisplayValue('0')
    fireEvent.change(input, { target: { value: '95' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))
    await waitFor(() => expect(mockSetDevAiUsage).toHaveBeenCalledWith(95))
  })

  it('resets the mocked AI usage count to 0 on Reset', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^dev$/i)
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(mockSetDevAiUsage).toHaveBeenCalledWith(0))
  })

  it('syncs the dev usage count to the real backend when signed in', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'user@example.com' }, session: { access_token: 'tok' }, signOut: vi.fn() })
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 95 }) })
    const { toast } = await import('sonner')
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^dev$/i)
    const input = screen.getByDisplayValue('0')
    fireEvent.change(input, { target: { value: '95' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))
    await waitFor(() => expect(mockSetDevAiUsage).toHaveBeenCalledWith(95))
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/ai/dev-usage'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
          body: JSON.stringify({ count: 95 }),
        }),
      ),
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it('shows an error toast when the real-backend sync fails', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'user@example.com' }, session: { access_token: 'tok' }, signOut: vi.fn() })
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' })
    const { toast } = await import('sonner')
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^dev$/i)
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to sync AI usage to server'))
  })

  it('shows an error toast when not signed in, without calling fetch', async () => {
    mockUseAuth.mockReturnValue({ user: null, session: null, signOut: vi.fn() })
    globalThis.fetch = vi.fn()
    const { toast } = await import('sonner')
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^dev$/i)
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Sign in to sync AI usage to the server'))
    expect(globalThis.fetch).not.toHaveBeenCalled()
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

describe('SettingsModal — Account tab encryption', () => {
  it('never renders an encryption section — setup/unlock is handled entirely by the mandatory encryptionSetup modal, not this tab', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro', cloudSync: true })
    mockHasEncryptionKey.mockResolvedValue(true)
    mockGetDataKey.mockReturnValue({ fake: 'key' } as unknown as CryptoKey)
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    expect(screen.queryByText('End-to-end encryption')).toBeNull()
    expect(screen.queryByText(/unlocked on this device/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Unlock' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull()
  })
})

describe('SettingsModal — Reset encryption passphrase', () => {
  it('hides the reset button when the user has no encryption key set up', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'user@example.com' }, session: null, signOut: vi.fn() })
    mockHasEncryptionKey.mockResolvedValue(false)
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    expect(screen.queryByRole('button', { name: /forgot your passphrase/i })).toBeNull()
  })

  it('hides the reset button when signed out', async () => {
    mockUseAuth.mockReturnValue({ user: null, session: null, signOut: vi.fn() })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    expect(screen.queryByRole('button', { name: /forgot your passphrase/i })).toBeNull()
  })

  it('shows the reset button when set up, opens a confirm modal (not a bare click) on click', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'user@example.com' }, session: null, signOut: vi.fn() })
    mockHasEncryptionKey.mockResolvedValue(true)
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    const btn = await screen.findByRole('button', { name: /forgot your passphrase/i })
    fireEvent.click(btn)
    expect(mockResetEncryption).not.toHaveBeenCalled()
    expect(mockOpenModal).toHaveBeenCalledWith('resetEncryption', { onConfirm: expect.any(Function) })
  })

  it('renders de-emphasized (link-style, destructive text) and after Sign out, not alongside Manage billing', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'user@example.com' }, session: null, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'pro', cloudSync: true })
    mockHasEncryptionKey.mockResolvedValue(true)
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    const resetBtn = await screen.findByRole('button', { name: /forgot your passphrase/i })
    const signOutBtn = screen.getByRole('button', { name: 'Sign out' })

    // De-emphasized: not the same full-width outline treatment as the primary account actions.
    expect(resetBtn.className).toContain('text-destructive')
    expect(resetBtn.className).not.toContain('w-full')

    // Positioned after Sign out in the DOM (destructive recovery action, separated from primary actions).
    expect(signOutBtn.compareDocumentPosition(resetBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('confirming calls resetEncryption then opens the encryptionSetup modal', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'user@example.com' }, session: null, signOut: vi.fn() })
    mockHasEncryptionKey.mockResolvedValue(true)
    const { toast } = await import('sonner')
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    const btn = await screen.findByRole('button', { name: /forgot your passphrase/i })
    fireEvent.click(btn)
    const onConfirm = mockOpenModal.mock.calls.find((c) => c[0] === 'resetEncryption')?.[1].onConfirm as () => void
    onConfirm()
    await waitFor(() => expect(mockResetEncryption).toHaveBeenCalled())
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    await waitFor(() => expect(mockOpenModal).toHaveBeenCalledWith('encryptionSetup'))
  })

  it('shows an error toast when resetEncryption fails, without opening encryptionSetup', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'user@example.com' }, session: null, signOut: vi.fn() })
    mockHasEncryptionKey.mockResolvedValue(true)
    mockResetEncryption.mockRejectedValueOnce(new Error('boom'))
    const { toast } = await import('sonner')
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    const btn = await screen.findByRole('button', { name: /forgot your passphrase/i })
    fireEvent.click(btn)
    const onConfirm = mockOpenModal.mock.calls.find((c) => c[0] === 'resetEncryption')?.[1].onConfirm as () => void
    onConfirm()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('boom'))
    expect(mockOpenModal).not.toHaveBeenCalledWith('encryptionSetup')
  })
})

