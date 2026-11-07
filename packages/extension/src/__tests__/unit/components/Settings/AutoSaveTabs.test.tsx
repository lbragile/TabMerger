import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AUTO_SAVE_MESSAGE, FREE_TIER_LIMITS } from '@tabmerger/shared'
import { AutoSaveTabs } from '@/components/Settings/AutoSaveTabs'
import { AUTO_SAVE_STATE_KEY } from '@/lib/syncSettingKeys'

const h = vi.hoisted(() => ({
  entitlements: { tier: 'pro', loading: false } as Record<string, unknown>,
  settings: { data: undefined as unknown, isLoading: false },
  saveSettings: vi.fn(),
  stored: new Map<string, unknown>(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  track: vi.fn(),
  listeners: [] as Array<(m: unknown) => void>,
}))

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => h.entitlements }))
vi.mock('@/hooks/useAppSettings', () => ({
  useAppSettings: () => h.settings,
  useSaveAppSettings: () => ({ mutateAsync: h.saveSettings }),
  DEFAULT_APP_SETTINGS: { theme: 'system' },
}))
vi.mock('@/lib/localDb', () => ({ getSetting: async (k: string, d: unknown) => (h.stored.has(k) ? h.stored.get(k) : d) }))
vi.mock('@/lib/toast', () => ({ toast: h.toast }))
vi.mock('@/lib/analytics', () => ({ trackEvent: (...a: unknown[]) => h.track(...a) }))

let sendMessage: ReturnType<typeof vi.fn>
let tabsCreate: ReturnType<typeof vi.fn>

function renderIt(onSettingsSaved = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <AutoSaveTabs onSettingsSaved={onSettingsSaved} />
    </QueryClientProvider>
  )
  return { onSettingsSaved, qc }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.entitlements = { tier: 'pro', loading: false }
  h.settings = { data: { theme: 'system' }, isLoading: false }
  h.saveSettings.mockResolvedValue(undefined)
  h.stored.clear()
  h.listeners = []
  sendMessage = vi.fn()
  tabsCreate = vi.fn()
  ;(globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      sendMessage,
      onMessage: { addListener: (l: (m: unknown) => void) => h.listeners.push(l), removeListener: vi.fn() },
    },
    tabs: { create: tabsCreate },
  }
})

const toggle = () => screen.getByRole('switch', { name: 'Auto-save open tabs' })

describe('AutoSaveTabs', () => {
  it('Pro, never toggled: on by default with the Pro copy, no upgrade link', () => {
    renderIt()
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Every auto-save is kept/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Upgrade to keep them all/ })).toBeNull()
    expect(screen.getByText('No auto-save yet.')).toBeInTheDocument()
  })

  it('Free, never toggled: off by default, explains the newest-2 rule and the limits, with an upgrade link', () => {
    h.entitlements = { tier: 'free', loading: false }
    renderIt()
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(new RegExp(`newest 2 auto-saves.*${FREE_TIER_LIMITS.groups} groups and ${FREE_TIER_LIMITS.tabs} tabs`))).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Auto-save schedule' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to keep them all' }))
    expect(h.track).toHaveBeenCalledWith('upgrade_clicked', { source: 'settings_auto_save' })
    expect(tabsCreate).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/pricing') }))
  })

  it('while the plan loads: neither default is shown and the switch is disabled', () => {
    h.entitlements = { tier: 'free', loading: true }
    renderIt()
    expect(screen.getByText('Checking your plan...')).toBeInTheDocument()
    expect(toggle()).toBeDisabled()
  })

  it('a toggle saves an explicit value and patches the draft', async () => {
    const { onSettingsSaved } = renderIt()
    fireEvent.click(toggle())
    await waitFor(() => expect(h.saveSettings).toHaveBeenCalledWith({ theme: 'system', autoSaveTabsEnabled: false }))
    expect(onSettingsSaved).toHaveBeenCalledWith({ autoSaveTabsEnabled: false })
  })

  it('a failed save shows a toast and does not patch the draft', async () => {
    h.saveSettings.mockRejectedValue(new Error('x'))
    const { onSettingsSaved } = renderIt()
    fireEvent.click(screen.getByRole('switch', { name: 'Show a notification' }))
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Could not save the auto-save setting'))
    expect(onSettingsSaved).not.toHaveBeenCalled()
  })

  it('does not save while settings are still loading', () => {
    h.settings = { data: undefined, isLoading: true }
    renderIt()
    fireEvent.click(screen.getByRole('switch', { name: 'Show a notification' }))
    expect(h.saveSettings).not.toHaveBeenCalled()
  })

  it('both triggers off: the hint asks for a schedule or a tab count', () => {
    h.settings = { data: { autoSaveTabsEnabled: true, autoSaveIntervalMinutes: 0, autoSaveTabThreshold: 0 }, isLoading: false }
    renderIt()
    expect(screen.getByText('Pick a schedule or a tab count to auto-save.')).toBeInTheDocument()
  })

  it('shows the selected options by their labels', () => {
    h.settings = { data: { autoSaveTabsEnabled: true, autoSaveIntervalMinutes: 1440, autoSaveTabThreshold: 50 }, isLoading: false }
    renderIt()
    expect(screen.getByRole('combobox', { name: 'Auto-save schedule' })).toHaveTextContent('Daily')
    expect(screen.getByRole('combobox', { name: 'Open-tab count that starts an auto-save' })).toHaveTextContent('50 open tabs')
  })

  it('status line from the last run, refreshed when the worker says so', async () => {
    h.stored.set(AUTO_SAVE_STATE_KEY, { last: { status: 'skipped', at: Date.now() - 5000, reason: 'nothing-new' } })
    const { qc } = renderIt()
    await waitFor(() => expect(screen.getByTestId('auto-save-status')).toHaveTextContent(/Nothing new to save/))
    h.stored.set(AUTO_SAVE_STATE_KEY, { last: { status: 'saved', at: Date.now(), groupId: 'g', groupName: 'Auto-saved X', saved: 3, total: 3, replaced: 0 } })
    h.listeners.forEach((l) => l({ type: 'unrelated' }))
    h.listeners.forEach((l) => l({ type: AUTO_SAVE_MESSAGE.STATUS_CHANGED }))
    await waitFor(() => expect(screen.getByTestId('auto-save-status')).toHaveTextContent('Saved 3 tabs to Auto-saved X.'))
    expect(qc).toBeTruthy()
  })

  it('"Auto-save now" asks the worker and toasts the outcome', async () => {
    sendMessage.mockResolvedValueOnce({ status: 'saved', at: 1, groupId: 'g', groupName: 'N', saved: 1, total: 1, replaced: 0 })
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Auto-save now' }))
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Saved 1 tab to N.'))
    expect(sendMessage).toHaveBeenCalledWith({ type: AUTO_SAVE_MESSAGE.RUN_NOW })

    sendMessage.mockResolvedValueOnce({ status: 'skipped', at: 1, reason: 'nothing-new' })
    fireEvent.click(screen.getByRole('button', { name: 'Auto-save now' }))
    await waitFor(() => expect(h.toast.info).toHaveBeenCalled())

    sendMessage.mockRejectedValueOnce(new Error('no worker'))
    fireEvent.click(screen.getByRole('button', { name: 'Auto-save now' }))
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Auto-save did not work. Try again.'))

    sendMessage.mockResolvedValueOnce('garbage')
    fireEvent.click(screen.getByRole('button', { name: 'Auto-save now' }))
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(2))
  })
})
