import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Dialog, DialogContent } from '@/components/ui/dialog'

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: false }))
vi.mock('@/lib/demo', () => ({ enterDemoMode: vi.fn() }))
vi.mock('@/lib/localDb', () => ({
  getSetting: vi.fn().mockResolvedValue({ theme: 'system', syncEnabled: true }),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getDb: vi.fn().mockResolvedValue({ clear: vi.fn() }),
  clearAllLocalData: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/theme', () => ({ applyTheme: vi.fn() }))
vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: vi.fn().mockResolvedValue('absent'),
  getDataKey: vi.fn().mockResolvedValue(null),
  resetEncryption: vi.fn(),
}))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ tier: 'free', cloudSync: false }) }))
vi.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => ({ used: 0, remaining: 0, cap: 0, loading: false }) }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, session: null, signOut: vi.fn() }) }))
vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => ({ data: { available: [] } }),
  useImportGroups: () => ({ mutate: vi.fn() }),
  GROUPS_QUERY_KEY: ['groups'],
}))
vi.mock('@/lib/importExport', () => ({
  importGroups: vi.fn(),
  parseBookmarksHtml: vi.fn(),
  parseOneTabs: vi.fn(),
  skippedSuffix: () => '',
  exportGroups: vi.fn().mockReturnValue('{}'),
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/dataConsent', () => ({ requestDataConsent: vi.fn().mockResolvedValue(true) }))
vi.mock('@/components/Settings/OtherDevices', () => ({ OtherDevices: () => null }))
vi.mock('@/components/Settings/AutoBackups', () => ({ AutoBackups: () => null }))

import { SettingsModal } from '@/components/Modal/Settings'

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <Dialog open>
        <DialogContent>
          <SettingsModal onClose={vi.fn()} />
        </DialogContent>
      </Dialog>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome
})

/** Tour v2 anchors in Settings: the Theme row and its control, and the Save changes button. */
describe('SettingsModal tour anchors', () => {
  it('labels the Theme select "Theme" and anchors both the row and the control', async () => {
    renderModal()
    const trigger = await screen.findByRole('combobox', { name: 'Theme' })
    expect(trigger).toHaveAttribute('data-tour', 'settings-theme-trigger')
    expect(trigger.closest('[data-tour="settings-theme"]')).not.toBeNull()
  })

  it('anchors Save changes (disabled until something changes), and no other footer button', async () => {
    renderModal()
    const save = await screen.findByRole('button', { name: 'Save changes' })
    expect(save).toHaveAttribute('data-tour', 'settings-save-button')
    expect(document.querySelector('[data-tour="settings-save-button"]:not([disabled])')).toBeNull()
    expect(screen.getByRole('button', { name: 'Restore defaults' })).not.toHaveAttribute('data-tour')
    // the old footer anchor is gone
    expect(document.querySelector('[data-tour="settings-save"]')).toBeNull()
  })

  it('Save changes matches the enabled selector once a setting is changed', async () => {
    const user = userEvent.setup()
    renderModal()
    await screen.findByRole('combobox', { name: 'Theme' })
    await user.click(screen.getAllByRole('switch')[0])
    await waitFor(() => expect(document.querySelector('[data-tour="settings-save-button"]:not([disabled])')).not.toBeNull())
  })
})
