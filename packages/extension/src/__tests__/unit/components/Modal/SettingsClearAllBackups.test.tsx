/**
 * Settings → Data → "Clear all data": the confirmation only says account backups are kept when the
 * Data tab's backups section has just SEEN some in the signed-in account (cached download result).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { SettingsModal } from '@/components/Modal/Settings'
import { autoBackupDownloadQueryKey } from '@/lib/autoBackupQueryKeys'

const h = vi.hoisted(() => ({ openModal: vi.fn(), user: null as { id: string } | null }))

vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: vi.fn().mockResolvedValue('absent'),
  getDataKey: vi.fn().mockResolvedValue(null),
  resetEncryption: vi.fn(),
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: false, AI_MANAGED_ENABLED: false, AI_BYOK_ENABLED: false }))
vi.mock('@/lib/demo', () => ({ enterDemoMode: vi.fn() }))
vi.mock('@/lib/localDb', () => ({
  getSetting: vi.fn().mockResolvedValue({ theme: 'system', autoBackupEnabled: true, autoBackupIntervalMinutes: 1440 }),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getDb: vi.fn(),
  clearAllLocalData: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/theme', () => ({ applyTheme: vi.fn() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ tier: 'free', cloudSync: false }) }))
vi.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => ({ used: 0, remaining: 100, cap: 100, loading: false }) }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: h.user, session: null, signOut: vi.fn() }) }))
vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => ({ data: { available: [] } }),
  useImportGroups: () => ({ mutate: vi.fn() }),
  GROUPS_QUERY_KEY: ['groups'],
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/dataConsent', () => ({ requestDataConsent: vi.fn().mockResolvedValue(true) }))
vi.mock('@/components/Settings/OtherDevices', () => ({ OtherDevices: () => null }))
vi.mock('@/components/Settings/AutoBackups', () => ({ AutoBackups: () => null }))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: Object.assign((sel: (s: object) => unknown) => sel({ openModal: h.openModal }), { getState: () => ({ clearHistory: vi.fn() }) }),
}))

async function openClearAll(cached: unknown, userId: string | null) {
  h.user = userId ? { id: userId } : null
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (cached !== undefined) qc.setQueryData(autoBackupDownloadQueryKey('user-1'), cached)
  render(
    <QueryClientProvider client={qc}>
      <Dialog open><DialogContent><SettingsModal onClose={vi.fn()} /></DialogContent></Dialog>
    </QueryClientProvider>
  )
  await userEvent.setup().click(await screen.findByRole('tab', { name: /^data$/i }))
  fireEvent.click(screen.getByRole('button', { name: /clear all data/i }))
  await waitFor(() => expect(h.openModal).toHaveBeenCalled())
  return h.openModal.mock.calls[0][1] as Record<string, unknown>
}

beforeEach(() => h.openModal.mockClear())

describe('Settings → Clear all data: cloudBackupsKept', () => {
  it('is passed for a signed-in user whose download found at least one account backup', async () => {
    const data = await openClearAll({ status: 'done', added: 0, inAccount: 3, unreadable: 0 }, 'user-1')
    expect(data.cloudBackupsKept).toBe(true)
  })

  it.each([
    ['signed out', { status: 'done', added: 0, inAccount: 3, unreadable: 0 }, null],
    ['no download result yet', undefined, 'user-1'],
    ['zero backups in the account', { status: 'done', added: 0, inAccount: 0, unreadable: 0 }, 'user-1'],
    ['download blocked', { status: 'blocked', reason: 'locked' }, 'user-1'],
    ['download busy', { status: 'busy' }, 'user-1'],
  ])('is not passed when %s', async (_n, cached, userId) => {
    const data = await openClearAll(cached, userId)
    expect('cloudBackupsKept' in data).toBe(false)
    expect(data.onConfirm).toEqual(expect.any(Function))
  })

  it('a result cached for another user id is ignored', async () => {
    h.user = { id: 'user-2' }
    const qc = new QueryClient()
    qc.setQueryData(autoBackupDownloadQueryKey('user-1'), { status: 'done', added: 0, inAccount: 2, unreadable: 0 })
    render(
      <QueryClientProvider client={qc}>
        <Dialog open><DialogContent><SettingsModal onClose={vi.fn()} /></DialogContent></Dialog>
      </QueryClientProvider>
    )
    await userEvent.setup().click(await screen.findByRole('tab', { name: /^data$/i }))
    fireEvent.click(screen.getByRole('button', { name: /clear all data/i }))
    await waitFor(() => expect(h.openModal).toHaveBeenCalled())
    expect('cloudBackupsKept' in (h.openModal.mock.calls[0][1] as object)).toBe(false)
  })
})
