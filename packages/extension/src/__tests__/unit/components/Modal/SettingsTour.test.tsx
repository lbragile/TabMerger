import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Dialog, DialogContent } from '@/components/ui/dialog'

const { mockTrackEvent } = vi.hoisted(() => ({ mockTrackEvent: vi.fn() }))

vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))
vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: false, AI_MANAGED_ENABLED: false, AI_BYOK_ENABLED: false }))
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
  skippedContext: (n: number) => ({ skipped: n }),
  exportGroups: vi.fn().mockReturnValue('{}'),
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/dataConsent', () => ({ requestDataConsent: vi.fn().mockResolvedValue(true) }))
vi.mock('@/components/Settings/OtherDevices', () => ({ OtherDevices: () => null }))
vi.mock('@/components/Settings/AutoBackups', () => ({ AutoBackups: () => null }))

import { SettingsModal } from '@/components/Modal/Settings'
import { useUIStore } from '@/stores/uiStore'

function renderModal(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <Dialog open>
        <DialogContent>
          <SettingsModal onClose={onClose} />
        </DialogContent>
      </Dialog>
    </QueryClientProvider>
  )
  return onClose
}

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ tourActive: false, tourStepId: null, modal: { type: null } })
  globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome
})

describe('SettingsModal — Take the tour (General tab)', () => {
  it('shows a "Take the tour" row on the General tab', async () => {
    renderModal()
    expect(await screen.findByText('Take the tour')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start the tour' })).toBeInTheDocument()
  })

  it('closes Settings and starts the tour from the first step', async () => {
    const user = userEvent.setup()
    const onClose = renderModal()
    await user.click(await screen.findByRole('button', { name: 'Start the tour' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(useUIStore.getState()).toMatchObject({ tourActive: true, tourStepId: null }))
    expect(mockTrackEvent).toHaveBeenCalledWith('tour_started', { source: 'settings' })
  })

  it('replays from step 1 even after an earlier tour left a remembered step', async () => {
    useUIStore.setState({ tourStepId: 'search' })
    const user = userEvent.setup()
    renderModal()
    await user.click(await screen.findByRole('button', { name: 'Start the tour' }))
    expect(useUIStore.getState().tourStepId).toBeNull()
  })
})
