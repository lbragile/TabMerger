import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AUTO_BACKUP_COPY, AUTO_BACKUP_MESSAGE } from '@tabmerger/shared'
import type { Group, Session } from '@/lib/types'
import { AutoBackups, describeBackupDownload } from '@/components/Settings/AutoBackups'
import { BACKUP_DOWNLOAD_MESSAGES } from '@/lib/autoBackupDownload'

const h = vi.hoisted(() => ({
  entitlements: { cloudSync: true, maxGroups: Infinity, maxTabs: Infinity } as Record<string, unknown>,
  settings: { data: undefined as unknown, isLoading: false },
  saveSettings: vi.fn(),
  user: { id: 'user-1' } as { id: string } | null,
  sessions: [] as unknown[],
  groups: { available: [] as unknown[] },
  importMutate: vi.fn(),
  replaceMutate: vi.fn(),
  download: vi.fn(),
  deleteAutoBackup: vi.fn(),
  blockOverLimit: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  track: vi.fn(),
  onMessageListeners: [] as Array<(m: unknown) => void>,
}))

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => h.entitlements }))
vi.mock('@/hooks/useAppSettings', () => ({
  useAppSettings: () => h.settings,
  useSaveAppSettings: () => ({ mutateAsync: h.saveSettings }),
  DEFAULT_APP_SETTINGS: { theme: 'system', autoBackupEnabled: true, autoBackupIntervalMinutes: 1440 },
}))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: h.user }) }))
vi.mock('@/hooks/useSessions', () => ({ useSessions: () => ({ data: h.sessions }), SESSIONS_QUERY_KEY: ['sessions'] }))
vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => ({ data: h.groups }),
  useImportGroups: () => ({ mutate: h.importMutate }),
  useReplaceSavedGroups: () => ({ mutate: h.replaceMutate }),
}))
vi.mock('@/lib/autoBackup', async () => {
  const actual = await vi.importActual<typeof import('@/lib/autoBackup')>('@/lib/autoBackup')
  return { ...actual, deleteAutoBackup: (...a: unknown[]) => h.deleteAutoBackup(...a) }
})
vi.mock('@/lib/autoBackupDownload', async () => {
  const actual = await vi.importActual<typeof import('@/lib/autoBackupDownload')>('@/lib/autoBackupDownload')
  return { ...actual, downloadAutoBackups: (...a: unknown[]) => h.download(...a) }
})
vi.mock('@/lib/tierLimits', async () => ({ ...(await vi.importActual<typeof import('@/lib/tierLimits')>('@/lib/tierLimits')), blockImportOverFreeLimit: (...a: unknown[]) => h.blockOverLimit(...a) }))
vi.mock('@/lib/autoBackupFile', async () => ({ ...(await vi.importActual<typeof import('@/lib/autoBackupFile')>('@/lib/autoBackupFile')), hasBackupFilePermission: async () => false }))
vi.mock("@/lib/localDb", async () => ({ ...(await vi.importActual<typeof import("@/lib/localDb")>("@/lib/localDb")), getSetting: async (_k: string, d: unknown) => d, setSetting: async () => {} }))
vi.mock('@/lib/toast', () => ({ toast: h.toast }))
vi.mock('@/lib/analytics', () => ({ trackEvent: (...a: unknown[]) => h.track(...a) }))

async function clickBackUpNow() {
  const isIdle = () => {
    const b = screen.getByRole('button', { name: /back up now/i })
    return !b.hasAttribute('disabled') && b.getAttribute('aria-disabled') !== 'true'
  }
  await waitFor(() => expect(isIdle()).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: /back up now/i }))
}

const group = (id: string, tabs = 2): Group => ({
  id,
  name: `G ${id}`,
  color: 'rgba(1, 2, 3, 1)',
  updatedAt: 1,
  windows: [{ id: 1, incognito: false, focused: false, tabs: Array.from({ length: tabs }, (_, i) => ({ id: 0, title: `t${i}`, url: `https://example.com/${id}/${i}` })) }],
})
const backup = (id: string, createdAt: number, groups: Group[] = [group('a')]): Session => ({ id, name: id, groups, createdAt, auto: true })

let sendMessage: ReturnType<typeof vi.fn>
let tabsCreate: ReturnType<typeof vi.fn>
let qc: QueryClient

function renderIt(props: Partial<{ onSettingsSaved: (p: unknown) => void; onRestored: () => void }> = {}) {
  const onSettingsSaved = props.onSettingsSaved ?? vi.fn()
  const onRestored = props.onRestored ?? vi.fn()
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={qc}>
      <AutoBackups onSettingsSaved={onSettingsSaved} onRestored={onRestored} />
    </QueryClientProvider>
  )
  return { ...utils, onSettingsSaved, onRestored }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.entitlements = { cloudSync: true, maxGroups: Infinity, maxTabs: Infinity }
  h.settings = { data: { theme: 'dark', autoBackupEnabled: true, autoBackupIntervalMinutes: 1440 }, isLoading: false }
  h.saveSettings.mockResolvedValue(undefined)
  h.user = { id: 'user-1' }
  h.sessions = []
  h.groups = { available: [] }
  h.download.mockResolvedValue({ status: 'done', added: 0, inAccount: 0, unreadable: 0 })
  h.deleteAutoBackup.mockResolvedValue(undefined)
  h.blockOverLimit.mockReturnValue(false)
  h.onMessageListeners.length = 0
  sendMessage = vi.fn()
  tabsCreate = vi.fn()
  ;(globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((l: (m: unknown) => void) => h.onMessageListeners.push(l)),
        removeListener: vi.fn(),
      },
    },
    tabs: { create: tabsCreate },
  }
  vi.stubGlobal('confirm', vi.fn(() => true))
  // Radix Select needs these in jsdom
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

describe('describeBackupDownload', () => {
  it('loading wins', () => {
    expect(describeBackupDownload(undefined, true, true)).toMatch(/Checking/)
  })
  it('nothing to say for no result or busy', () => {
    expect(describeBackupDownload(undefined, false, true)).toBeNull()
    expect(describeBackupDownload({ status: 'busy' }, false, true)).toBeNull()
  })
  it.each(['signed-out', 'account-mismatch', 'no-key', 'key-unknown', 'locked', 'fetch-failed'] as const)('blocked %s uses the shared message for a paid account', (reason) => {
    expect(describeBackupDownload({ status: 'blocked', reason }, false, true)).toBe(BACKUP_DOWNLOAD_MESSAGES[reason])
  })
  it('a free account is not told to set up encryption', () => {
    expect(describeBackupDownload({ status: 'blocked', reason: 'no-key' }, false, false)).toBeNull()
    expect(describeBackupDownload({ status: 'blocked', reason: 'locked' }, false, false)).toBe(BACKUP_DOWNLOAD_MESSAGES.locked)
  })
  it('done: reports added (singular/plural) and unreadable', () => {
    expect(describeBackupDownload({ status: 'done', added: 1, inAccount: 1, unreadable: 0, dropped: 0, removed: 0 }, false, true)).toBe('Brought back 1 backup stored in your account.')
    expect(describeBackupDownload({ status: 'done', added: 3, inAccount: 3, unreadable: 0, dropped: 0, removed: 0 }, false, true)).toMatch(/Brought back 3 backups/)
    expect(describeBackupDownload({ status: 'done', added: 0, inAccount: 0, unreadable: 2, dropped: 0, removed: 0 }, false, true)).toMatch(/can't be read/)
    const both = describeBackupDownload({ status: 'done', added: 2, inAccount: 2, unreadable: 1, dropped: 0, removed: 0 }, false, true)!
    expect(both).toMatch(/Brought back 2/)
    expect(both).toMatch(/can't be read/)
    expect(describeBackupDownload({ status: 'done', added: 0, inAccount: 4, unreadable: 0, dropped: 0, removed: 0 }, false, true)).toBeNull()
  })
})

describe('AutoBackups — paid account', () => {
  it('shows the switch, interval, Back up now and no upgrade button', async () => {
    renderIt()
    expect(screen.getByRole('switch', { name: AUTO_BACKUP_COPY.title })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Backup interval' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back up now/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /upgrade to pro/i })).toBeNull()
    expect(screen.getByText('No backup yet')).toBeInTheDocument()
    await waitFor(() => expect(h.download).toHaveBeenCalled())
  })

  it('toggling the switch saves immediately, merged over the stored settings, and patches the draft', async () => {
    const { onSettingsSaved } = renderIt()
    fireEvent.click(screen.getByRole('switch', { name: AUTO_BACKUP_COPY.title }))
    await waitFor(() => expect(h.saveSettings).toHaveBeenCalledWith({ theme: 'dark', autoBackupEnabled: false, autoBackupIntervalMinutes: 1440 }))
    await waitFor(() => expect(onSettingsSaved).toHaveBeenCalledWith({ autoBackupEnabled: false }))
  })

  it('choosing an interval saves it and patches the draft', async () => {
    const { onSettingsSaved } = renderIt()
    fireEvent.click(screen.getByRole('combobox', { name: 'Backup interval' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Every hour' }))
    await waitFor(() => expect(h.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ autoBackupIntervalMinutes: 60 })))
    await waitFor(() => expect(onSettingsSaved).toHaveBeenCalledWith({ autoBackupIntervalMinutes: 60 }))
  })

  it('the interval control is unavailable while backups are off', () => {
    h.settings = { data: { autoBackupEnabled: false, autoBackupIntervalMinutes: 60 }, isLoading: false }
    renderIt()
    expect(screen.getByRole('combobox', { name: 'Backup interval' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: AUTO_BACKUP_COPY.title })).not.toBeChecked()
  })

  it('does not save (and does not patch the draft) while settings are still loading', () => {
    h.settings = { data: undefined, isLoading: true }
    const { onSettingsSaved } = renderIt()
    fireEvent.click(screen.getByRole('switch', { name: AUTO_BACKUP_COPY.title }))
    expect(h.saveSettings).not.toHaveBeenCalled()
    expect(onSettingsSaved).not.toHaveBeenCalled()
  })

  it('a failed save shows an error and does not patch the draft', async () => {
    h.saveSettings.mockRejectedValue(new Error('idb'))
    const { onSettingsSaved } = renderIt()
    fireEvent.click(screen.getByRole('switch', { name: AUTO_BACKUP_COPY.title }))
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled())
    expect(onSettingsSaved).not.toHaveBeenCalled()
  })

  it('old stored settings without the keys show the defaults (on, daily)', () => {
    h.settings = { data: { theme: 'dark' }, isLoading: false }
    renderIt()
    expect(screen.getByRole('switch', { name: AUTO_BACKUP_COPY.title })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Backup interval' })).toHaveTextContent('Daily')
  })

  it('lists backups newest first with group and tab counts, and shows the last backup time', () => {
    h.sessions = [
      backup('new', Date.now() - 60_000, [group('a', 3), group('b', 1)]),
      { ...backup('manual', Date.now(), [group('m')]), auto: undefined },
      backup('old', Date.now() - 5 * 86_400_000),
    ]
    renderIt()
    const list = screen.getByRole('list', { name: 'Automatic backups list' })
    const items = list.querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toMatch(/2 groups · 4 tabs/)
    expect(items[1].textContent).toMatch(/1 group · 2 tabs/)
    expect(screen.getByText(/Last backup: 1 min ago/)).toBeInTheDocument()
  })

  it('shows the download note from the account fetch', async () => {
    h.download.mockResolvedValue({ status: 'done', added: 2, inAccount: 2, unreadable: 0 })
    renderIt()
    expect(await screen.findByText(/Brought back 2 backups/)).toBeInTheDocument()
  })

  it('shows the blocked-download message', async () => {
    h.download.mockResolvedValue({ status: 'blocked', reason: 'locked' })
    renderIt()
    expect(await screen.findByText(BACKUP_DOWNLOAD_MESSAGES.locked)).toBeInTheDocument()
  })

  it('refreshes the list when the worker announces a completed backup, and ignores other messages', async () => {
    renderIt()
    await waitFor(() => expect(h.onMessageListeners).toHaveLength(1))
    const spy = vi.spyOn(qc, 'invalidateQueries')
    h.onMessageListeners[0]({ type: 'SOMETHING_ELSE' })
    h.onMessageListeners[0](null)
    expect(spy).not.toHaveBeenCalled()
    h.onMessageListeners[0]({ type: AUTO_BACKUP_MESSAGE.COMPLETED })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['sessions'] })
  })
})

describe('AutoBackups — Back up now', () => {
  const created = { status: 'created', sessionId: 's', createdAt: 1, uploaded: true, pruned: 0 }

  it('asks the worker to run now, toasts success and re-fetches the account backups', async () => {
    sendMessage.mockResolvedValue(created)
    renderIt()
    await waitFor(() => expect(h.download).toHaveBeenCalledTimes(1))
    await clickBackUpNow()
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Backup saved.'))
    expect(sendMessage).toHaveBeenCalledWith({ type: AUTO_BACKUP_MESSAGE.RUN_NOW })
    await waitFor(() => expect(h.download).toHaveBeenCalledTimes(2))
  })

  it('a second click that reports nothing changed is an info toast, not an error', async () => {
    sendMessage.mockResolvedValue({ status: 'skipped', reason: 'unchanged' })
    renderIt()
    await clickBackUpNow()
    await waitFor(() => expect(h.toast.info).toHaveBeenCalledWith('Nothing has changed since the last backup.'))
    expect(h.toast.success).not.toHaveBeenCalled()
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it.each([[{ status: 'error', message: 'x' }], [null], ['garbage'], [{ status: 'created' }]])('an error or unreadable reply %j is an error toast', async (reply) => {
    sendMessage.mockResolvedValue(reply)
    renderIt()
    await clickBackUpNow()
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('The backup could not be created. Try again.'))
  })

  it('a rejected message is an error toast and the button works again', async () => {
    sendMessage.mockRejectedValue(new Error('no worker'))
    renderIt()
    await clickBackUpNow()
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: /back up now/i })).toBeInTheDocument())
  })

  it('invalidates the sessions list afterwards', async () => {
    sendMessage.mockResolvedValue(created)
    renderIt()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    await clickBackUpNow()
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['sessions'] }))
  })
})

describe('AutoBackups — restore and delete', () => {
  beforeEach(() => {
    h.sessions = [backup('b1', Date.now() - 1000, [group('a', 2), group('b', 1)])]
    h.groups = { available: [group('cur')] }
  })
  const restoreBtn = () => screen.getByRole('button', { name: /^Restore backup from/ })
  const deleteBtn = () => screen.getByRole('button', { name: /^Delete backup from/ })
  const open = () => fireEvent.click(restoreBtn())

  it('Restore only opens the choice: nothing is imported or replaced yet', () => {
    renderIt()
    open()
    expect(screen.getByRole('button', { name: 'Add to my groups' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace my groups' })).toBeInTheDocument()
    expect(h.importMutate).not.toHaveBeenCalled()
    expect(h.replaceMutate).not.toHaveBeenCalled()
  })

  it('"Add to my groups" imports fresh groups through the import path, tracks, toasts and calls onRestored; no confirm, no replace', () => {
    h.importMutate.mockImplementation((_g: unknown, o: { onSuccess: () => void }) => o.onSuccess())
    const { onRestored } = renderIt()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Add to my groups' }))
    expect(h.importMutate).toHaveBeenCalledTimes(1)
    expect(h.importMutate.mock.calls[0][0] as Group[]).toHaveLength(2)
    expect(h.replaceMutate).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    expect(h.toast.success).toHaveBeenCalledWith(expect.stringMatching(/^Restored 2 groups/))
    expect(h.track).toHaveBeenCalledWith('auto_backup_restored', { mode: 'add' })
    expect(onRestored).toHaveBeenCalled()
  })

  it('"Replace my groups" asks first (naming how many current groups go), then replaces and does not import', () => {
    h.replaceMutate.mockImplementation((_g: unknown, o: { onSuccess: () => void }) => o.onSuccess())
    const { onRestored } = renderIt()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Replace my groups' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/Replace your groups with the 2 groups from this backup\? Your 1 current group will be removed/))
    expect(h.replaceMutate).toHaveBeenCalledTimes(1)
    expect(h.importMutate).not.toHaveBeenCalled()
    expect(h.track).toHaveBeenCalledWith('auto_backup_restored', { mode: 'replace' })
    expect(onRestored).toHaveBeenCalled()
  })

  it('"Replace" declined in the confirm changes nothing', () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    renderIt()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Replace my groups' }))
    expect(h.replaceMutate).not.toHaveBeenCalled()
    expect(h.importMutate).not.toHaveBeenCalled()
  })

  it('checks the Free limits against the current groups: append for Add, replace for Replace; blocked means nothing happens', () => {
    h.entitlements = { cloudSync: false, maxGroups: 5, maxTabs: 50 }
    h.blockOverLimit.mockReturnValue(true)
    renderIt()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Add to my groups' }))
    expect(h.blockOverLimit).toHaveBeenCalledWith({ maxGroups: 5, maxTabs: 50 }, [expect.objectContaining({ id: 'cur' })], expect.any(Array), 'append')
    fireEvent.click(screen.getByRole('button', { name: 'Replace my groups' }))
    expect(h.blockOverLimit).toHaveBeenLastCalledWith({ maxGroups: 5, maxTabs: 50 }, expect.any(Array), expect.any(Array), 'replace')
    expect(confirm).not.toHaveBeenCalled()
    expect(h.importMutate).not.toHaveBeenCalled()
    expect(h.replaceMutate).not.toHaveBeenCalled()
  })

  it('Cancel closes the choice', () => {
    renderIt()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Add to my groups' })).toBeNull()
  })

  it('a backup with no readable groups is an error and does not import', () => {
    h.sessions = [backup('b1', Date.now() - 1000, [])]
    renderIt()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Add to my groups' }))
    expect(h.toast.error).toHaveBeenCalled()
    expect(h.importMutate).not.toHaveBeenCalled()
  })

  it('a failed import or replace shows an error', () => {
    h.importMutate.mockImplementation((_g: unknown, o: { onError: () => void }) => o.onError())
    h.replaceMutate.mockImplementation((_g: unknown, o: { onError: () => void }) => o.onError())
    renderIt()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Add to my groups' }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace my groups' }))
    expect(h.toast.error).toHaveBeenCalledTimes(2)
    expect(h.toast.error).toHaveBeenCalledWith('Could not restore this backup')
  })

  it('delete asks first with the shared scope sentence (removed from this browser and the account), then deletes by id', async () => {
    renderIt()
    fireEvent.click(deleteBtn())
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(AUTO_BACKUP_COPY.deleteScope))
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/cannot be undone/))
    await waitFor(() => expect(h.deleteAutoBackup).toHaveBeenCalled())
    expect(h.deleteAutoBackup.mock.calls[0][0]).toBe('b1')
  })

  it('delete does nothing when declined', () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    renderIt()
    fireEvent.click(deleteBtn())
    expect(h.deleteAutoBackup).not.toHaveBeenCalled()
  })

  it('there is no "Removed N" line anywhere, whatever the download reports', async () => {
    h.download.mockResolvedValue({ status: 'done', added: 1, inAccount: 3, unreadable: 0, dropped: 0, removed: 2 })
    renderIt()
    await waitFor(() => expect(h.download).toHaveBeenCalled())
    await screen.findByText(/Brought back 1 backup/)
    expect(screen.queryByText(/^Removed \d/)).toBeNull()
  })
})

describe('AutoBackups — free or downgraded account', () => {
  beforeEach(() => {
    h.entitlements = { cloudSync: false, maxGroups: 5, maxTabs: 50 }
  })

  it('shows the explanation and an upgrade button, with no working controls', () => {
    renderIt()
    expect(screen.getByText(AUTO_BACKUP_COPY.upgradeDescription)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: /back up now/i })).toBeNull()
  })

  it('the upgrade button tracks the source and opens the pricing page', () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }))
    expect(h.track).toHaveBeenCalledWith('upgrade_clicked', { source: 'settings_auto_backup' })
    expect(tabsCreate).toHaveBeenCalledWith({ url: expect.stringMatching(/\/pricing$/), active: true })
  })

  it('never sends a run request', () => {
    renderIt()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('a downgraded account keeps its existing backups to restore or delete, with an explanation and no new-backup controls', () => {
    h.sessions = [backup('b1', Date.now() - 1000)]
    renderIt()
    expect(screen.getByText(/no longer includes automatic backups/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Restore backup from/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Delete backup from/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /back up now/i })).toBeNull()
  })

  it('without backups the downgrade note is absent', () => {
    renderIt()
    expect(screen.queryByText(/no longer includes automatic backups/)).toBeNull()
  })
})
