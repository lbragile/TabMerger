import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { SettingsModal } from '@/components/Modal/Settings'

/** An option by the language's own name (its accessible name goes on: ", German, Right-to-left"). */
const native = (name: string) => new RegExp(`^${name}(,|$)`)


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
  mockClearAllLocalData,
  mockClearHistory,
  mockOpenModal,
  mockEnterDemoMode,
  mockTrackEvent,
  mockUseAiUsage,
  mockGetEncryptionKeyState,
  mockGetDataKey,
  mockResetEncryption,
  mockRequestDataConsent,
  mockToastError,
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
  mockClearAllLocalData: vi.fn().mockResolvedValue(undefined),
  mockClearHistory: vi.fn(),
  mockOpenModal: vi.fn(),
  mockEnterDemoMode: vi.fn().mockResolvedValue(undefined),
  mockTrackEvent: vi.fn(),
  mockUseAiUsage: vi.fn(),
  mockGetEncryptionKeyState: vi.fn().mockResolvedValue('absent'),
  mockGetDataKey: vi.fn().mockResolvedValue(null),
  mockResetEncryption: vi.fn().mockResolvedValue(undefined),
  mockRequestDataConsent: vi.fn().mockResolvedValue(true),
  mockToastError: vi.fn(),
}))

vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: mockGetEncryptionKeyState,
  getDataKey: mockGetDataKey,
  resetEncryption: mockResetEncryption,
}))

vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))
// This suite tests the Dev tab's AI credits debug tool itself, not the
// coming-soon flag, so force it on regardless of the real VITE_AI_ENABLED default.
// A getter, so a test can switch AI off (the "Show AI button" switch is only offered while AI is on).
const aiFlag = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/lib/aiFlag', () => ({
  get AI_ENABLED() { return aiFlag.enabled },
  AI_MANAGED_ENABLED: true,
  AI_BYOK_ENABLED: true,
}))

vi.mock('@/lib/demo', () => ({ enterDemoMode: mockEnterDemoMode }))

vi.mock('@/lib/localDb', () => ({
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
  getDb: mockGetDb,
  clearAllLocalData: mockClearAllLocalData,
}))

vi.mock('@/lib/theme', () => ({ applyTheme: mockApplyTheme }))

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => mockUseAiUsage() }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => mockUseGroups(),
  useImportGroups: () => ({ mutate: mockImportGroupsMutate }),
  GROUPS_QUERY_KEY: ['groups'],
}))
vi.mock('@/lib/importExport', () => ({
  importGroups: vi.fn().mockReturnValue({ groups: [{ name: 'g' }], skipped: 0 }),
  parseBookmarksHtml: vi.fn().mockReturnValue({ groups: [], skipped: 0 }),
  parseOneTabs: vi.fn().mockReturnValue({ groups: [], skipped: 0 }),
  skippedContext: (n: number) => (n > 0 ? { context: 'skipped', skipped: n } : { skipped: n }),
  exportGroups: mockExportGroups,
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: mockToastError } }))
vi.mock('@/lib/dataConsent', () => ({ requestDataConsent: mockRequestDataConsent }))
vi.mock('@/components/Settings/OtherDevices', () => ({ OtherDevices: () => <div>Other devices panel</div> }))
// The Data tab's backups section has its own data hooks (sessions, entitlements), so it is stubbed here like OtherDevices.
vi.mock('@/components/Settings/AutoBackups', () => ({ AutoBackups: () => <div>Automatic backups panel</div> }))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: Object.assign((sel: (s: { openModal: typeof mockOpenModal }) => unknown) => sel({ openModal: mockOpenModal }), {
    getState: () => ({ clearHistory: mockClearHistory })
  })
}))

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
  showPreviewImages: false,
  autoBackupEnabled: true,
  autoBackupIntervalMinutes: 1440,
  autoBackupFileEnabled: false,
  autoBackupFileFolder: 'TabMerger',
  autoBackupFilePattern: 'TabMerger backup {date} {time}',
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
  aiFlag.enabled = true
  mockGetSetting.mockResolvedValue(DEFAULT_SETTINGS)
  mockUseEntitlements.mockReturnValue({ tier: 'free', cloudSync: false })
  mockUseAiUsage.mockReturnValue({ used: 0, remaining: 100, cap: 100, loading: false })
  mockUseAuth.mockReturnValue({ user: null, session: null, signOut: vi.fn() })
  mockUseGroups.mockReturnValue({ data: { available: [] } })
  globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome
  globalThis.confirm = vi.fn().mockReturnValue(true) // the native box must never be used: tests assert it
  globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:x')
  globalThis.URL.revokeObjectURL = vi.fn()
  mockGetEncryptionKeyState.mockResolvedValue('absent')
  mockGetDataKey.mockReturnValue(null)
  mockRequestDataConsent.mockResolvedValue(true)
})

describe('SettingsModal — version badge in title', () => {
  const originalChrome = globalThis.chrome

  afterEach(() => {
    globalThis.chrome = originalChrome
  })

  it('shows __TABMERGER_VERSION__ (the injected build semver), not the manifest version, on every browser', async () => {
    // __TABMERGER_VERSION__ is defined as '0.0.0-test' in vitest.config.ts — same value
    // regardless of what getManifest() returns, since the badge no longer reads the manifest
    // for this at all (Chrome's version_name and Firefox's offset store version would both be
    // wrong to show here — see the component's own comment).
    globalThis.chrome = {
      tabs: { create: vi.fn() },
      runtime: { getManifest: () => ({ version: '4.1.0.5', version_name: '3.1.0-beta.5' }) },
    } as unknown as typeof chrome
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(screen.getByText('Settings').closest('h2, [role="heading"], div')).toBeTruthy()
    expect(screen.getByText('v0.0.0-test')).toBeInTheDocument()
  })

  it('renders nothing when chrome.runtime.getManifest is unavailable', async () => {
    globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument()
  })
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

  it('has a "Describe groups and windows" switch, on for settings saved before it existed, that turns off', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', cloudSync: true, aiFeatures: true })
    renderModal()
    await goToTab(/^ai$/i)
    expect(screen.getByText('Write a short note about the tabs of a group or window with AI')).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'Describe groups and windows' })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Name groups and windows' })).toBeChecked()
    // The same switches gate the window ⋯ menu items, so their copy names both
    expect(screen.getByText('Suggest a name for a group or window with AI')).toBeInTheDocument()
  })
})

describe('SettingsModal — opening on a requested tab', () => {
  function renderOn(initialTab: unknown) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const ui = () => (
      <QueryClientProvider client={qc}>
        <Dialog open><DialogContent><SettingsModal onClose={vi.fn()} initialTab={initialTab} /></DialogContent></Dialog>
      </QueryClientProvider>
    )
    const view = render(ui())
    return { rerender: () => view.rerender(ui()) }
  }
  const selectedTab = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')

  it('opens on the AI tab when the account is already loaded', () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', cloudSync: true, aiFeatures: true })
    renderOn('ai')
    expect(selectedTab()?.textContent).toBe('AI')
  })

  it('shows the AI tab once the account loads, even after the open focus selected General', async () => {
    // Signed-in state is read after mount: no AI tab on the first render
    mockUseEntitlements.mockReturnValue({ tier: 'free', cloudSync: false, aiFeatures: false })
    const { rerender } = renderOn('ai')
    const general = screen.getByRole('tab', { name: /^general$/i })
    act(() => general.focus()) // the dialog's open focus; Radix selects a tab on focus
    expect(selectedTab()).toBe(general)

    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', cloudSync: true, aiFeatures: true })
    rerender()
    const ai = screen.getByRole('tab', { name: /^ai$/i })
    await waitFor(() => expect(selectedTab()).toBe(ai))
    expect(document.activeElement).toBe(ai)
  })

  it('applies the request once: a tab the user picks afterwards stays picked', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'free', cloudSync: false, aiFeatures: false })
    const { rerender } = renderOn('ai')
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', cloudSync: true, aiFeatures: true })
    rerender()
    await waitFor(() => expect(selectedTab()?.textContent).toBe('AI'))

    await goToTab(/^data$/i)
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', cloudSync: true, aiFeatures: true, maxGroups: 99 })
    rerender()
    expect(selectedTab()?.textContent).toBe('Data')
  })

  it('does not move focus when it is outside the tab list', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'free', cloudSync: false, aiFeatures: false })
    const { rerender } = renderOn('ai')
    const close = screen.getByRole('button', { name: /close/i })
    act(() => close.focus())
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', cloudSync: true, aiFeatures: true })
    rerender()
    await waitFor(() => expect(selectedTab()?.textContent).toBe('AI'))
    expect(document.activeElement).toBe(close)
  })

  it('a requested tab the account lacks is not added (no Devices tab on Free)', () => {
    mockUseEntitlements.mockReturnValue({ tier: 'free', cloudSync: false, aiFeatures: false })
    const { rerender } = renderOn('devices')
    rerender()
    expect(screen.queryByRole('tab', { name: /^devices$/i })).toBeNull()
    expect(screen.getByRole('tabpanel')).toBeTruthy()
  })

  it('an unknown tab opens General', () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', cloudSync: true, aiFeatures: true })
    renderOn('nope')
    expect(selectedTab()?.textContent).toBe('General')
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
    // showPreviewImages(3), cloud sync(4) — cloud sync only renders when cloudSync is true.
    await waitFor(() => expect(screen.getAllByRole('switch')[4]).not.toBeChecked())
    const syncSwitch = screen.getAllByRole('switch')[4]
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

describe('SettingsModal — Show AI button (General)', () => {
  const aiSwitch = () => screen.getByRole('switch', { name: 'Show AI button' })

  it.each([['free', { tier: 'free', cloudSync: false }], ['pro', { tier: 'pro', cloudSync: true }], ['pro_ai', { tier: 'pro_ai', cloudSync: true, aiFeatures: true }]])(
    'a %s user finds it on the General tab, on by default (settings saved before it existed lack it)',
    async (_tier, ent) => {
      mockUseEntitlements.mockReturnValue(ent)
      renderModal()
      await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
      expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true')
      expect(aiSwitch()).toBeChecked()
      expect(screen.getByText('The ✨ button in the header, with AI actions for your tabs and groups')).toBeTruthy()
    }
  )

  it('turning it off saves showAiButton: false', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    fireEvent.click(aiSwitch())
    expect(aiSwitch()).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(mockSetSetting).toHaveBeenCalledWith('appSettings', expect.objectContaining({ showAiButton: false })))
  })

  it('shows a saved "off" and turns back on', async () => {
    mockGetSetting.mockResolvedValue({ ...DEFAULT_SETTINGS, showAiButton: false })
    renderModal()
    await waitFor(() => expect(aiSwitch()).not.toBeChecked())
    fireEvent.click(aiSwitch())
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(mockSetSetting).toHaveBeenCalledWith('appSettings', expect.objectContaining({ showAiButton: true })))
  })

  it('is not offered while AI features are off (coming soon): there is no button to show', async () => {
    aiFlag.enabled = false
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(screen.queryByRole('switch', { name: 'Show AI button' })).toBeNull()
  })
})

describe('SettingsModal — Show page images in previews', () => {
  it('defaults to off and shows the shortened always-visible helper text', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(screen.getByText('Show page images in previews')).toBeTruthy()
    expect(
      screen.getByText('Hovering a tab sends its address to fetch a page image. Not stored or linked to you.')
    ).toBeTruthy()
    const toggle = screen.getByRole('switch', { name: /show page images in previews/i })
    expect(toggle).not.toBeChecked()
  })

  it('REGRESSION: turning the toggle on enables it directly (no separate confirmation modal) and Save persists it', async () => {
    const user = userEvent.setup()
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    const toggle = screen.getByRole('switch', { name: /show page images in previews/i })

    await user.click(toggle)

    expect(toggle).toBeChecked()
    expect(mockOpenModal).not.toHaveBeenCalledWith('confirmPreviewImages', expect.anything())
    const saveBtn = screen.getByRole('button', { name: /save changes/i })
    expect(saveBtn).not.toBeDisabled()
    await user.click(saveBtn)
    await waitFor(() =>
      expect(mockSetSetting).toHaveBeenCalledWith('appSettings', expect.objectContaining({ showPreviewImages: true }))
    )
  })

  it('requests browsingActivity consent before turning on, and leaves it off + shows a message when denied', async () => {
    mockRequestDataConsent.mockResolvedValue(false)
    const user = userEvent.setup()
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    const toggle = screen.getByRole('switch', { name: /show page images in previews/i })

    await user.click(toggle)

    expect(mockRequestDataConsent).toHaveBeenCalledWith(['browsingActivity'])
    expect(toggle).not.toBeChecked()
    expect(mockToastError).toHaveBeenCalledWith(
      "Firefox needs permission to fetch page images. Allow it in the browser's prompt to turn this on."
    )
  })

  it('disables the setting immediately when turned off', async () => {
    mockGetSetting.mockResolvedValue({ ...DEFAULT_SETTINGS, showPreviewImages: true })
    const user = userEvent.setup()
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    const toggle = await screen.findByRole('switch', { name: /show page images in previews/i })
    // Settings load asynchronously; the switch shows the default (off) until they arrive.
    await waitFor(() => expect(toggle).toBeChecked())

    await user.click(toggle)

    expect(toggle).not.toBeChecked()
  })

  it('opens the privacy policy in a new tab via chrome.tabs.create', async () => {
    const user = userEvent.setup()
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await user.click(screen.getByRole('link', { name: /privacy policy/i }))
    expect(chrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('/privacy#page-previews'), active: true })
    )
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

  it('confirming the clearAllData modal wipes every store through the QUEUED wipe (not raw store clears)', async () => {
    const clearMock = vi.fn().mockResolvedValue(undefined)
    mockGetDb.mockResolvedValue({ clear: clearMock })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^data$/i)
    fireEvent.click(screen.getByRole('button', { name: /clear all data/i }))
    const onConfirm = mockOpenModal.mock.calls[0][1].onConfirm as () => void
    onConfirm()
    await waitFor(() => expect(mockClearAllLocalData).toHaveBeenCalledOnce())
    expect(clearMock).not.toHaveBeenCalled() // no raw db.clear outside the write queue
    expect(mockClearHistory).toHaveBeenCalled() // undo snapshots of the wiped data must not be restorable
  })

  function fileInput() {
    return document.querySelector('input[type="file"]') as HTMLInputElement
  }

  const chooseFile = (name = 'backup.json') =>
    fireEvent.change(fileInput(), { target: { files: [new File(['{}'], name, { type: 'application/json' })] } })
  const openDataTab = async () => {
    const onClose = vi.fn()
    renderModal(onClose)
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^data$/i)
    return onClose
  }

  it('importing a .json file asks in-app first (default focus on the action), imports on confirm and closes Settings', async () => {
    mockImportGroupsMutate.mockImplementation((_g: unknown, o: { onSuccess: () => void }) => o.onSuccess())
    const onClose = await openDataTab()
    chooseFile()
    const box = await screen.findByRole('alertdialog', { name: 'Import 1 group?' })
    expect(box).toHaveTextContent('The 1 group in "backup.json" will be added next to the groups you already have.')
    expect(mockImportGroupsMutate).not.toHaveBeenCalled()
    const action = within(box).getByRole('button', { name: 'Import 1 group' })
    expect(action).toHaveFocus() // not destructive: the action is the default
    fireEvent.click(action)
    await waitFor(() => expect(mockImportGroupsMutate).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalled()
    expect(globalThis.confirm).not.toHaveBeenCalled()
  })

  it('the question names the plural count for several groups', async () => {
    const { importGroups } = await import('@/lib/importExport')
    ;(importGroups as ReturnType<typeof vi.fn>).mockReturnValueOnce({ groups: [{ name: 'a' }, { name: 'b' }], skipped: 0 })
    await openDataTab()
    chooseFile()
    const box = await screen.findByRole('alertdialog', { name: 'Import 2 groups?' })
    expect(within(box).getByRole('button', { name: 'Import 2 groups' })).toBeInTheDocument()
  })

  it('a file name longer than 60 characters is cut in the question', async () => {
    await openDataTab()
    chooseFile(`${'f'.repeat(70)}.json`)
    const box = await screen.findByRole('alertdialog')
    expect(box).toHaveTextContent(`"${'f'.repeat(60)}…"`)
    expect(box).not.toHaveTextContent('f'.repeat(61))
  })

  it('a file name with markup is shown as text', async () => {
    await openDataTab()
    chooseFile('<img src=x onerror=alert(1)>.json')
    const box = await screen.findByRole('alertdialog')
    expect(box.querySelector('img')).toBeNull()
    expect(box).toHaveTextContent('<img src=x onerror=alert(1)>.json')
  })

  it('Cancel imports nothing, keeps Settings open and returns focus to the Import button', async () => {
    const onClose = await openDataTab()
    chooseFile()
    const box = await screen.findByRole('alertdialog')
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(mockImportGroupsMutate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Import' })).toHaveFocus()
  })

  it('Escape cancels the import question without closing Settings', async () => {
    const onClose = await openDataTab()
    chooseFile()
    await screen.findByRole('alertdialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(mockImportGroupsMutate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument()
  })

  it('choosing the same file again after Cancel asks again (the input is cleared)', async () => {
    await openDataTab()
    chooseFile()
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(fileInput().value).toBe('')
    chooseFile()
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Import 1 group' }))
    await waitFor(() => expect(mockImportGroupsMutate).toHaveBeenCalledTimes(1))
  })

  it('shows an error toast and skips the mutation when the parsed file has zero groups', async () => {
    const { importGroups } = await import('@/lib/importExport')
    ;(importGroups as ReturnType<typeof vi.fn>).mockReturnValueOnce({ groups: [], skipped: 4 })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^data$/i)
    const file = new File(['{}'], 'empty.json', { type: 'application/json' })
    fireEvent.change(fileInput(), { target: { files: [file] } })
    await waitFor(() => expect(mockImportGroupsMutate).not.toHaveBeenCalled())
  })

  it('blocks the import (before the confirm dialog) when it would exceed the free group limit', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'free', cloudSync: false, maxGroups: 1, maxTabs: 50 })
    mockUseGroups.mockReturnValue({ data: { available: [{ name: 'Now Open', permanent: true, windows: [] }, { name: 'existing', windows: [] }] } })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^data$/i)
    // importGroups() is mocked (module-level) to return a single group — pushes total saved groups to 2, over maxGroups:1
    const { toast } = await import('@/lib/toast')
    const file = new File(['{}'], 'backup.json', { type: 'application/json' })
    fireEvent.change(fileInput(), { target: { files: [file] } })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Free plan allows up to 1 groups.', expect.anything()))
    expect(screen.queryByRole('alertdialog')).toBeNull()
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

  // The control's own behavior is covered in components/Settings/DevAiCredits.test.tsx
  it('shows the "Credits used this month" control in the Dev tab and posts what is set', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'user@example.com' }, session: { access_token: 'tok' }, signOut: vi.fn() })
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 95 }) })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/^dev$/i)
    fireEvent.change(screen.getByLabelText('Credits used this month'), { target: { value: '95' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/ai/dev-usage'),
        expect.objectContaining({ body: JSON.stringify({ count: 95 }) }),
      ),
    )
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
    await waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://billing.example.com/', active: true }))
  })

  it('shows an error toast when the portal request fails', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro', cloudSync: true })
    mockUseAuth.mockReturnValue({ user: { email: 'user@example.com' }, session: { access_token: 'tok' }, signOut: vi.fn() })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ error: 'nope' }) })
    const { toast } = await import('@/lib/toast')
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

  it.each([
    ['pro', 'Pro (US$3.99/mo)'],
    ['pro_ai', 'Pro AI (US$7.99/mo)'],
    ['free', 'Free'],
  ])('labels the %s plan with its price marked as US dollars', async (tier, label) => {
    mockUseEntitlements.mockReturnValue({ tier, cloudSync: tier !== 'free' })
    mockUseAuth.mockReturnValue({ user: { email: 'user@example.com' }, session: { access_token: 'tok' }, signOut: vi.fn() })
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    expect(screen.getByText(label)).toBeInTheDocument()
  })
})

describe('SettingsModal — Account tab encryption', () => {
  it('never renders an encryption section — setup/unlock is handled entirely by the mandatory encryptionSetup modal, not this tab', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro', cloudSync: true })
    mockGetEncryptionKeyState.mockResolvedValue('present')
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
    mockGetEncryptionKeyState.mockResolvedValue('absent')
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    await goToTab(/account/i)
    expect(screen.queryByRole('button', { name: /forgot your passphrase/i })).toBeNull()
  })

  it('hides the reset button when the encryption status could not be checked', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'user@example.com' }, session: null, signOut: vi.fn() })
    mockGetEncryptionKeyState.mockResolvedValue('unknown')
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
    mockGetEncryptionKeyState.mockResolvedValue('present')
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
    mockGetEncryptionKeyState.mockResolvedValue('present')
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
    mockGetEncryptionKeyState.mockResolvedValue('present')
    const { toast } = await import('@/lib/toast')
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
    mockGetEncryptionKeyState.mockResolvedValue('present')
    mockResetEncryption.mockRejectedValueOnce(new Error('boom'))
    const { toast } = await import('@/lib/toast')
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



describe('SettingsModal — switches are findable by role and name', () => {
  it.each(['Confirm before deleting', 'Open tab on click', 'Auto-deduplicate on merge', 'Show page images in previews'])(
    'the "%s" switch has that accessible name and reflects its stored state',
    async (name) => {
      renderModal()
      await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
      const sw = await screen.findByRole('switch', { name })
      expect(sw).toHaveAttribute('aria-checked', expect.stringMatching(/true|false/))
    }
  )

  it('toggling a switch by its name flips it', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    const sw = await screen.findByRole('switch', { name: 'Confirm before deleting' })
    const before = sw.getAttribute('aria-checked')
    fireEvent.click(sw)
    expect(screen.getByRole('switch', { name: 'Confirm before deleting' }).getAttribute('aria-checked')).not.toBe(before)
  })

  it('the hide/dim select for non-matching search results has a name too', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(await screen.findByRole('combobox', { name: 'Tabs that do not match a search' })).toBeInTheDocument()
  })
})

describe('SettingsModal — Language', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => false)
    localStorage.clear()
  })
  afterEach(async () => {
    localStorage.clear()
    const { i18n } = await import('@/lib/i18n')
    await i18n.changeLanguage('en')
  })

  /** The row's button: named by the row's label, then the draft ("Language Français"). */
  const languageButton = () => screen.getByTestId('settings-language')

  it('opens the language list as a modal popover, so the Settings dialog scroll lock does not swallow the mouse wheel', async () => {
    renderModal()
    fireEvent.click(languageButton())
    await screen.findAllByRole('option')
    // A modal Radix popover hides everything outside it from assistive tech (and takes the scroll
    // lock); a non-modal one leaves the rest of Settings, like the Theme row, exposed.
    expect(screen.getByText('Theme').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('gives every dropdown on the General tab the same width, the language picker included', async () => {
    const { SETTINGS_SELECT_WIDTH } = await import('@/components/Settings/settingsControls')
    renderModal()
    const dropdowns = [languageButton(), ...screen.getAllByRole('combobox')]
    expect(dropdowns.length).toBeGreaterThanOrEqual(4)
    for (const dropdown of dropdowns) {
      const widths = dropdown.className.split(/\s+/).filter((c) => /^w-/.test(c))
      expect(widths).toEqual([SETTINGS_SELECT_WIDTH])
    }
  })

  it('lists Browser default first, then every language by its own name, in a searchable list', async () => {
    const { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES } = await import('@tabmerger/shared')
    renderModal()
    fireEvent.click(languageButton())
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.querySelector('[data-native]')?.textContent)).toEqual(['Browser default', ...SUPPORTED_LOCALES.map((l) => LOCALE_NATIVE_NAMES[l])])
    expect(screen.getByRole('option', { name: native('Deutsch') }).querySelector('[data-native]')).toHaveAttribute('lang', 'de')
    // the search box has focus and narrows the list; Browser default always stays
    const search = screen.getByRole('combobox', { name: 'Search languages by name or code' })
    await waitFor(() => expect(search).toHaveFocus())
    fireEvent.change(search, { target: { value: 'deu' } })
    expect(screen.getAllByRole('option').map((o) => o.querySelector('[data-native]')?.textContent)).toEqual(['Browser default', 'Deutsch'])
  })

  it('applies a picked language on Save, not before, and stores it', async () => {
    const { i18n } = await import('@/lib/i18n')
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    fireEvent.click(languageButton())
    fireEvent.click(await screen.findByRole('option', { name: native('Deutsch') }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(languageButton()).toHaveAccessibleName('Language Deutsch')
    expect(i18n.language).toBe('en')
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(i18n.language).toBe('de'))
    expect(localStorage.getItem('tabmerger-locale')).toBe('de')
    expect(document.documentElement.lang).toBe('de')
    // the open modal re-renders in German
    expect(await screen.findByRole('button', { name: 'Sprache Deutsch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Änderungen speichern' })).toBeDisabled()
  })

  it('closing Settings without Save (Cancel) leaves the language, direction and stored choice unchanged', async () => {
    const { i18n } = await import('@/lib/i18n')
    const { unmount } = renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    fireEvent.click(languageButton())
    fireEvent.click(await screen.findByRole('option', { name: native('Deutsch') }))
    expect(languageButton()).toHaveAccessibleName('Language Deutsch')
    unmount()
    expect(i18n.language).toBe('en')
    expect(localStorage.getItem('tabmerger-locale')).toBeNull()
    // reopening starts from the stored choice again
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(languageButton()).toHaveTextContent('Browser default')
  })

  it('Save of Hebrew sets html lang and dir=rtl, and saving English again restores dir=ltr', async () => {
    const { i18n } = await import('@/lib/i18n')
    const { unmount } = renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    fireEvent.click(languageButton())
    fireEvent.click(await screen.findByRole('option', { name: native('עברית') }))
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(i18n.language).toBe('he'))
    expect(document.documentElement.lang).toBe('he')
    expect(document.documentElement.dir).toBe('rtl')
    unmount()

    renderModal()
    await waitFor(() => expect(languageButton()).toHaveTextContent('עברית'))
    fireEvent.click(languageButton())
    fireEvent.click(await screen.findByRole('option', { name: native('English') }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.general.saveChanges') }))
    await waitFor(() => expect(i18n.language).toBe('en'))
    expect(document.documentElement.lang).toBe('en')
    expect(document.documentElement.dir).toBe('ltr')
  })

  it('Enter in the search box picks the first match into the draft', async () => {
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    fireEvent.click(languageButton())
    const search = await screen.findByRole('combobox', { name: 'Search languages by name or code' })
    fireEvent.change(search, { target: { value: 'he' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(languageButton()).toHaveAccessibleName('Language עברית')
    expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled()
  })

  it('marks exactly Arabic, Hebrew and Persian as right-to-left, with the accessible text', async () => {
    renderModal()
    fireEvent.click(languageButton())
    const options = await screen.findAllByRole('option')
    const marked = options
      .filter((o) => o.querySelector('[data-rtl-mark]'))
      .map((o) => o.querySelector('[data-native]')?.getAttribute('lang'))
    expect(marked).toEqual(['ar', 'he', 'fa'])
    expect(screen.getByRole('option', { name: 'العربية, Arabic, Right-to-left' })).toBeInTheDocument()
    expect(languageButton().querySelector('[data-rtl-mark]')).toBeNull()
  })

  it('starts from the stored choice, and Restore defaults puts it back to Browser default', async () => {
    localStorage.setItem('tabmerger-locale', 'fr')
    renderModal()
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(languageButton()).toHaveTextContent('Français')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /restore defaults/i }))
    expect(languageButton()).toHaveTextContent('Browser default')
    expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled()
  })
})
