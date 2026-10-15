import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import {
  AUTO_BACKUP_COPY,
  AUTO_BACKUP_RETENTION_COUNT,
  DEFAULT_BACKUP_FILE_PATTERN,
  buildBackupFilePath,
  encryptBlob,
  generateDataKey,
  PRICING_TIERS,
} from '@tabmerger/shared'
import { toast } from 'sonner'
import { BackupsSection } from '@/components/dashboard/BackupsSection'
import { SavedSessionsProvider } from '@/components/dashboard/SavedSessionsProvider'
import { DAMAGED_ITEM_NOTE } from '@/components/dashboard/SessionCard'
import { SessionList } from '@/components/dashboard/SessionList'
import { SessionsStatDescription, SessionsStatValue } from '@/components/dashboard/SessionsStat'
import { StatsOverview } from '@/components/dashboard/StatsOverview'
import { SAVED_SESSIONS_READ_ONLY_NOTE, formatAbsoluteTime, formatRelativeTime } from '@/lib/savedSessions'

/**
 * The dashboard's split between "Saved Sessions" and "Backups". Rows are really encrypted and
 * decrypted (Web Crypto), because the only thing that marks a backup is inside the ciphertext.
 */

const h = vi.hoisted(() => ({
  key: null as CryptoKey | null,
  status: 'unlocked' as 'checking' | 'locked' | 'unlocked',
  refresh: vi.fn(),
  recheck: vi.fn(async () => {}),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/encryption/context', async (orig) => ({
  ...(await orig<typeof import('@/lib/encryption/context')>()),
  useEncryptionKey: () => ({ dataKey: h.key, recheck: h.recheck, status: h.status, keyVerified: true, unlock: vi.fn() }),
}))

type Row = { id: string; name: string; description: null; groups: unknown; created_at: string }

let realKey: CryptoKey
let otherKey: CryptoKey

const HOUR = 60 * 60 * 1000
const T0 = Date.now()
const iso = (hoursAgo: number) => new Date(T0 - hoursAgo * HOUR).toISOString()

const WORK = {
  id: 'g-work',
  name: 'Work',
  color: 'rgba(10, 20, 30, 1)',
  updatedAt: 1,
  windows: [
    {
      id: 0,
      incognito: false,
      focused: false,
      tabs: [
        { id: 0, url: 'https://docs.example/page', title: 'Docs page', pinned: true },
        { id: 0, url: 'javascript:alert(1)', title: 'Bookmarklet' },
        { id: 0, url: 'https://untitled.example/', title: '' },
      ],
    },
  ],
}
const PLAY = { id: 'g-play', name: 'Play', color: '#ff0000', updatedAt: 2, windows: [{ id: 0, incognito: false, focused: false, tabs: [{ id: 0, url: 'https://games.example', title: 'Games' }] }] }

async function row(id: string, hoursAgo: number, content: unknown, key: CryptoKey = realKey): Promise<Row> {
  const { iv, ct } = await encryptBlob(key, content)
  return { id, name: '', description: null, groups: { v: 1, iv, ct }, created_at: iso(hoursAgo) }
}

function Dashboard({ rows, syncEnabled = true, loadError = false }: { rows: Row[]; syncEnabled?: boolean; loadError?: boolean }) {
  return (
    <SavedSessionsProvider sessions={rows} loadError={loadError}>
      <h1>Dashboard</h1>
      <StatsOverview
        tabCount={0}
        groupCount={0}
        sessionCount={rows.length}
        sessionStat={{ value: <span data-testid="sessions-stat"><SessionsStatValue /></span>, description: <SessionsStatDescription /> }}
        memberSince="2024-01-01"
      />
      {/* As on the dashboard page: without cloud sync, shown only while rows saved before remain. */}
      {(syncEnabled || rows.length > 0) && (
        <div data-testid="sessions-section">
          <h2>Saved Sessions</h2>
          <SessionList isPro={syncEnabled} readOnly={!syncEnabled} />
        </div>
      )}
      <BackupsSection syncEnabled={syncEnabled} />
    </SavedSessionsProvider>
  )
}

const backupsRegion = () => screen.getByRole('region', { name: 'Backups' })
const sessionsSection = () => screen.getByTestId('sessions-section')
const backupItems = () => within(backupsRegion()).queryAllByRole('listitem')

beforeAll(async () => {
  realKey = await generateDataKey()
  otherKey = await generateDataKey()
})

beforeEach(() => {
  h.key = realKey
  h.status = 'unlocked'
  h.refresh.mockClear()
  h.recheck.mockClear()
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('split between Saved Sessions and Backups', () => {
  it('lists a row under Backups only when its decrypted content has the literal auto: true', async () => {
    const rows = [
      await row('r-auto', 3, { name: 'NAME-AUTO', groups: [WORK], auto: true }),
      await row('r-manual', 4, { name: 'NAME-MANUAL', groups: [WORK] }),
      await row('r-false', 5, { name: 'NAME-FALSE', groups: [WORK], auto: false }),
      await row('r-string', 6, { name: 'NAME-STRING', groups: [WORK], auto: 'true' }),
      await row('r-one', 7, { name: 'NAME-ONE', groups: [WORK], auto: 1 }),
    ]
    render(<Dashboard rows={rows} />)

    await waitFor(() => expect(backupItems()).toHaveLength(1))
    for (const name of ['NAME-MANUAL', 'NAME-FALSE', 'NAME-STRING', 'NAME-ONE']) {
      expect(within(sessionsSection()).getByText(name)).toBeInTheDocument()
      expect(within(backupsRegion()).queryByText(name)).toBeNull()
    }
    // The backup is not a session card any more, and no session carries the backup label.
    expect(within(sessionsSection()).queryByText('NAME-AUTO')).toBeNull()
    expect(within(sessionsSection()).queryByText(AUTO_BACKUP_COPY.namePrefix, { exact: false })).toBeNull()
    expect(within(sessionsSection()).getAllByRole('heading', { level: 3 })).toHaveLength(4)
  })

  it('counts only the saved sessions in the stats card', async () => {
    const rows = [
      await row('b1', 1, { name: 'b', groups: [WORK], auto: true }),
      await row('b2', 2, { name: 'b', groups: [WORK], auto: true }),
      await row('s1', 3, { name: 'Mine', groups: [WORK] }),
    ]
    render(<Dashboard rows={rows} />)
    await waitFor(() => expect(screen.getByTestId('sessions-stat')).toHaveTextContent(/^1$/))
    expect(screen.getByText('Browsing sessions stored')).toBeInTheDocument()
  })

  it('shows "No saved sessions yet" when every row is a backup', async () => {
    render(<Dashboard rows={[await row('b1', 1, { name: 'b', groups: [WORK], auto: true })]} />)
    await waitFor(() => expect(backupItems()).toHaveLength(1))
    expect(within(sessionsSection()).getByText('No saved sessions yet.')).toBeInTheDocument()
    expect(screen.getByTestId('sessions-stat')).toHaveTextContent(/^0$/)
  })

  it('keeps a standalone SessionList (no provider around it) free of backups too', async () => {
    const rows = [await row('b1', 1, { name: 'NAME-AUTO', groups: [WORK], auto: true }), await row('s1', 2, { name: 'NAME-MANUAL', groups: [WORK] })]
    render(<SessionList sessions={rows} isPro />)
    await screen.findByText('NAME-MANUAL')
    expect(screen.queryByText('NAME-AUTO')).toBeNull()
  })
})

describe('a backup row', () => {
  it('is listed newest first whatever order the rows arrive in', async () => {
    const rows = [
      await row('mid', 30, { name: 'b', groups: [WORK], auto: true }),
      await row('newest', 2, { name: 'b', groups: [WORK], auto: true }),
      await row('oldest', 300, { name: 'b', groups: [WORK], auto: true }),
    ]
    render(<Dashboard rows={rows} />)
    await waitFor(() => expect(backupItems()).toHaveLength(3))
    const times = backupItems().map((li) => li.querySelector('time')!.getAttribute('datetime'))
    expect(times).toEqual([rows[1].created_at, rows[0].created_at, rows[2].created_at])
  })

  it('shows when it was taken (absolute and relative), and its group and tab counts', async () => {
    const r = await row('b1', 3, { name: 'Automatic backup · ignored', groups: [WORK, PLAY], auto: true })
    render(<Dashboard rows={[r]} />)
    await waitFor(() => expect(backupItems()).toHaveLength(1))
    const item = within(backupItems()[0])
    const ms = Date.parse(r.created_at)

    expect(item.getByRole('heading', { level: 3 })).toHaveTextContent(formatAbsoluteTime(ms))
    expect(backupItems()[0].querySelector('time')).toHaveAttribute('datetime', r.created_at)
    expect(item.getByText(new RegExp(`${AUTO_BACKUP_COPY.namePrefix} · `))).toHaveTextContent(/3 hours ago/)
    expect(formatRelativeTime(ms, T0, 'en-US')).toBe('3 hours ago')
    expect(item.getByText('2 groups')).toBeInTheDocument()
    expect(item.getByText('4 tabs')).toBeInTheDocument()
    // The name inside the content is not parsed or shown: the time comes from the row.
    expect(item.queryByText(/ignored/)).toBeNull()
  })

  it('expands to its groups and tabs, with aria-expanded, links only for http(s) addresses', async () => {
    render(<Dashboard rows={[await row('b1', 3, { name: 'b', groups: [WORK, PLAY], auto: true })]} />)
    await waitFor(() => expect(backupItems()).toHaveLength(1))
    const item = within(backupItems()[0])

    const toggle = item.getByRole('button', { name: 'Show contents (2)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(item.queryByText('Work')).toBeNull()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveTextContent('Hide contents')
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toContainElement(item.getByText('Work'))
    expect(item.getByText('Play')).toBeInTheDocument()

    const link = item.getByRole('link', { name: 'Docs page' })
    expect(link).toHaveAttribute('href', 'https://docs.example/page')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    // A script address is text, never a link; a tab with no title shows its address.
    expect(item.getByText('Bookmarklet').closest('a')).toBeNull()
    expect(item.getByRole('link', { name: 'https://untitled.example/' })).toBeInTheDocument()
    expect(item.getAllByRole('link')).toHaveLength(3)

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(item.queryByText('Work')).toBeNull()
  })

  it('renders names and titles as text, not markup', async () => {
    const evil = { name: '<img src=x onerror=alert(1)>', windows: [{ tabs: [{ url: 'https://a.example', title: '<script>alert(1)</script>' }] }] }
    render(<Dashboard rows={[await row('b1', 3, { name: 'b', groups: [evil], auto: true })]} />)
    await waitFor(() => expect(backupItems()).toHaveLength(1))
    fireEvent.click(within(backupItems()[0]).getByRole('button', { name: /Show contents/ }))
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument()
    expect(backupsRegion().querySelector('img, script')).toBeNull()
  })

  it('says restoring is done in the extension and offers no restore control', async () => {
    render(<Dashboard rows={[await row('b1', 3, { name: 'b', groups: [WORK], auto: true })]} />)
    await waitFor(() => expect(backupItems()).toHaveLength(1))
    expect(within(backupsRegion()).getByText(/To restore one, open the extension and go to Settings > Data/)).toBeInTheDocument()
    expect(within(backupsRegion()).queryByRole('button', { name: /restore/i })).toBeNull()
  })
})

describe('download', () => {
  it('saves a JSON array of the stored groups (the format the extension imports), named by date', async () => {
    // Stored with the sync bookkeeping of the device that made it; none of it belongs in the file.
    const bookkeeping = { pendingSync: true, positionDirty: true, remoteUpdatedAt: '2030-01-01T00:00:00.000Z' }
    const r = await row('b1', 3, { name: 'b', groups: [{ ...WORK, ...bookkeeping }, { ...PLAY, pendingSync: false }], auto: true })
    let blob: Blob | undefined
    let downloadName = ''
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => ((blob = b), 'blob:test')), revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download
    })

    render(<Dashboard rows={[r]} />)
    await waitFor(() => expect(backupItems()).toHaveLength(1))
    fireEvent.click(within(backupItems()[0]).getByRole('button', { name: /^Download backup from / }))

    expect(click).toHaveBeenCalledTimes(1)
    // The extension's default file name (shared builder), from the row's created_at in local time.
    expect(downloadName).toMatch(/^TabMerger backup \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.json$/)
    expect(downloadName).toBe(buildBackupFilePath('', DEFAULT_BACKUP_FILE_PATTERN, { createdAt: Date.parse(r.created_at), groups: 2, tabs: 4 }))
    expect(blob!.type).toBe('application/json')
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blob!)
    })
    // Every stored field survives (ids, pinned, the non-http tab): the extension validates on import.
    expect(JSON.parse(text)).toEqual([WORK, PLAY])
    expect(text).not.toMatch(/pendingSync|positionDirty|remoteUpdatedAt/)
    expect(within(backupsRegion()).getByRole('status')).toHaveTextContent(/^Downloading the backup from /)
    // The temporary link does not stay in the page.
    expect(document.querySelector('a[download]')).toBeNull()
  })
})

describe('delete', () => {
  async function openDialog() {
    const r = await row('b 1/x', 3, { name: 'b', groups: [WORK, PLAY], auto: true })
    render(<Dashboard rows={[r, await row('s1', 4, { name: 'Mine', groups: [WORK] })]} />)
    await waitFor(() => expect(backupItems()).toHaveLength(1))
    fireEvent.click(within(backupItems()[0]).getByRole('button', { name: /^Delete backup from / }))
    return { r, dialog: await screen.findByRole('dialog', { name: 'Delete this backup?' }) }
  }

  it('asks first in a dialog that names the backup, and Cancel deletes nothing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { r, dialog } = await openDialog()

    expect(dialog).toHaveTextContent(`The backup from ${formatAbsoluteTime(Date.parse(r.created_at))} (2 groups, 4 tabs) will be removed from your account. A browser that already has this backup keeps its own copy.`)
    // Deleting here removes the account's copy only: nothing says a device loses its own.
    expect(dialog).not.toHaveTextContent(/from (all|every|your) (devices?|browsers?)/i)
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
    // Focus goes back to the button that opened the dialog, not to the page body.
    await waitFor(() => expect(within(backupItems()[0]).getByRole('button', { name: /^Delete backup from / })).toHaveFocus())
  })

  it('deletes the row by id, refreshes, announces it and moves focus to the section heading', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const { dialog } = await openDialog()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/b%201%2Fx', { method: 'DELETE' })
    expect(toast.success).toHaveBeenCalledWith('Backup deleted')
    expect(within(backupsRegion()).getByRole('status')).toHaveTextContent(/was deleted\.$/)
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Backups' })).toHaveFocus())
  })

  it.each([
    ['the server refuses', async () => ({ ok: false })],
    ['the request fails', async () => Promise.reject(new Error('offline'))],
  ])('reports a failure when %s and does not refresh', async (_label, impl) => {
    vi.stubGlobal('fetch', vi.fn(impl))
    const { dialog } = await openDialog()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to delete backup'))
    expect(h.refresh).not.toHaveBeenCalled()
    expect(within(backupsRegion()).getByRole('status')).toHaveTextContent(/could not be deleted\.$/)
    expect(backupItems()).toHaveLength(1)
  })
})

describe('states', () => {
  it('empty for a paid account: says how backups are made and where the interval is set', async () => {
    render(<Dashboard rows={[await row('s1', 4, { name: 'Mine', groups: [WORK] })]} />)
    const region = within(backupsRegion())
    expect(await region.findByText('No backups yet.')).toBeInTheDocument()
    expect(region.getByText(/saves one by itself while your browser is open/)).toHaveTextContent(/"Daily" unless you change it.*in the extension under Settings > Data/)
    expect(region.getByText(new RegExp(`The\\s+newest ${AUTO_BACKUP_RETENTION_COUNT} are kept`))).toBeInTheDocument()
    expect(backupItems()).toHaveLength(0)
  })

  it('empty with no rows at all needs no key', () => {
    h.key = null
    h.status = 'locked'
    render(<Dashboard rows={[]} />)
    expect(within(backupsRegion()).getByText('No backups yet.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Encryption passphrase')).toBeNull()
  })

  it('free account: explains the Pro feature with the upgrade link, and shows no rows or empty state', async () => {
    render(<Dashboard rows={[]} syncEnabled={false} />)
    const region = within(backupsRegion())
    expect(region.getByText(AUTO_BACKUP_COPY.upgradeDescription)).toBeInTheDocument()
    expect(region.getByRole('link', { name: 'Upgrade' })).toHaveAttribute('href', '/pricing')
    expect(region.queryByText('No backups yet.')).toBeNull()
    expect(region.queryByText(/To restore one/)).toBeNull()
    expect(backupItems()).toHaveLength(0)
  })

  it('locked: asks for the passphrase in both sections and the stat says it counts both kinds', async () => {
    h.key = null
    h.status = 'locked'
    const rows = [await row('b1', 1, { name: 'b', groups: [WORK], auto: true }), await row('s1', 2, { name: 'Mine', groups: [WORK] })]
    render(<Dashboard rows={rows} />)

    expect(within(backupsRegion()).getByText(/Your backups are end-to-end encrypted/)).toBeInTheDocument()
    expect(within(sessionsSection()).getByText(/Your sessions are end-to-end encrypted/)).toBeInTheDocument()
    expect(screen.getAllByLabelText('Encryption passphrase')).toHaveLength(2)
    expect(backupItems()).toHaveLength(0)
    expect(within(backupsRegion()).queryByText('No backups yet.')).toBeNull()
    expect(screen.getByTestId('sessions-stat')).toHaveTextContent(/^2$/)
    expect(screen.getByText('Sessions and backups (unlock to tell them apart)')).toBeInTheDocument()
  })

  it('loading: a status placeholder while the key state is unknown, then while decrypting', async () => {
    h.key = null
    h.status = 'checking'
    const rows = [await row('b1', 1, { name: 'b', groups: [WORK], auto: true })]
    const { rerender } = render(<Dashboard rows={rows} />)
    expect(within(backupsRegion()).getByRole('status', { name: 'Loading backups' })).toBeInTheDocument()
    expect(within(backupsRegion()).queryByText('No backups yet.')).toBeNull()
    expect(screen.getByTestId('sessions-stat')).toHaveTextContent('Loading')

    h.key = realKey
    h.status = 'unlocked'
    rerender(<Dashboard rows={rows} />)
    // Before the decrypt pass resolves: still loading, in both sections (no "nothing saved" flash).
    expect(within(backupsRegion()).getByRole('status', { name: 'Loading backups' })).toBeInTheDocument()
    expect(within(sessionsSection()).getByRole('status', { name: 'Loading sessions' })).toBeInTheDocument()
    expect(within(sessionsSection()).queryByText('No saved sessions yet.')).toBeNull()
    await waitFor(() => expect(backupItems()).toHaveLength(1))
    expect(within(backupsRegion()).queryByRole('status', { name: 'Loading backups' })).toBeNull()
  })

  it('error: says so in both sections and "Try again" reloads the data', async () => {
    render(<Dashboard rows={[]} loadError />)
    const region = within(backupsRegion())
    expect(region.getByRole('alert')).toHaveTextContent('Your backups could not be loaded.')
    expect(region.queryByText('No backups yet.')).toBeNull()
    expect(within(sessionsSection()).getByRole('alert')).toHaveTextContent('Your sessions could not be loaded.')

    fireEvent.click(region.getByRole('button', { name: 'Try again' }))
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })
})

describe('rows that cannot be read', () => {
  it('a row that will not decrypt stays under Saved Sessions as locked, and Backups says so', async () => {
    const rows = [
      await row('b1', 1, { name: 'b', groups: [WORK], auto: true }),
      // Really a backup, but written with another key: nothing here can know that.
      await row('stale', 2, { name: 'b', groups: [WORK], auto: true }, otherKey),
      await row('s1', 3, { name: 'Mine', groups: [WORK] }),
    ]
    render(<Dashboard rows={rows} />)
    await waitFor(() => expect(backupItems()).toHaveLength(1))

    expect(within(sessionsSection()).getByText('(locked)')).toBeInTheDocument()
    expect(within(sessionsSection()).getAllByRole('heading', { level: 3 })).toHaveLength(2)
    expect(within(backupsRegion()).getByText(/^1 saved item can't be read, so it isn't known whether it is a backup\. It is listed under Saved Sessions\.$/)).toBeInTheDocument()
    expect(h.recheck).toHaveBeenCalledWith([expect.stringMatching(/^sessions:stale:/)])
    // It still counts as a stored session: it is not dropped from both lists.
    expect(screen.getByTestId('sessions-stat')).toHaveTextContent(/^2$/)
  })

  it('uses the plural note for several, and no note when everything is readable', async () => {
    const readable = [await row('b1', 1, { name: 'b', groups: [WORK], auto: true })]
    const { unmount } = render(<Dashboard rows={readable} />)
    await waitFor(() => expect(backupItems()).toHaveLength(1))
    expect(within(backupsRegion()).queryByText(/can't be read/)).toBeNull()
    unmount()

    render(<Dashboard rows={[...readable, await row('x1', 2, { groups: [] }, otherKey), await row('x2', 3, 'just a string')]} />)
    await waitFor(() => expect(backupItems()).toHaveLength(1))
    expect(within(backupsRegion()).getByText(/^2 saved items can't be read/)).toBeInTheDocument()
  })

  it('content that is not an object is a damaged session: explained, not restorable, deletable', async () => {
    render(<Dashboard rows={[await row('junk', 1, ['not', 'a', 'session'])]} />)
    const section = within(sessionsSection())
    expect(await section.findByText(DAMAGED_ITEM_NOTE)).toBeInTheDocument()
    expect(section.getByRole('button', { name: 'Restore session' })).toHaveAttribute('aria-disabled', 'true')
    expect(section.getByRole('button', { name: 'Delete session' })).toBeInTheDocument()
    expect(section.queryByText(/0 groups/)).toBeNull()
    expect(backupItems()).toHaveLength(0)
  })

  it('a backup whose groups are not a list is shown as damaged: no counts, no download, still deletable', async () => {
    render(<Dashboard rows={[await row('b1', 1, { name: 'b', auto: true, groups: { length: 3 } })]} />)
    await waitFor(() => expect(backupItems()).toHaveLength(1))
    const item = within(backupItems()[0])
    expect(item.getByText(DAMAGED_ITEM_NOTE)).toBeInTheDocument()
    expect(item.queryByText(/\d+ groups?$/)).toBeNull()
    expect(item.queryByRole('button', { name: /^Download/ })).toBeNull()
    expect(item.queryByRole('button', { name: /contents/ })).toBeNull()
    expect(item.getByRole('button', { name: /^Delete backup from / })).toBeInTheDocument()
  })

  it('drops malformed entries inside a backup and never writes an unchecked colour into a style', async () => {
    const groups = [
      null,
      42,
      { name: { nested: true }, color: 'url(https://tracker.example/pixel.png)', windows: [{ tabs: [{ url: 5 }, { url: 'https://ok.example', title: { a: 1 } }] }, 'window'] },
    ]
    render(<Dashboard rows={[await row('b1', 1, { name: 'b', auto: true, groups })]} />)
    await waitFor(() => expect(backupItems()).toHaveLength(1))
    const item = within(backupItems()[0])
    expect(item.getByText('1 group')).toBeInTheDocument()
    expect(item.getByText('1 tab')).toBeInTheDocument()

    fireEvent.click(item.getByRole('button', { name: 'Show contents (1)' }))
    expect(item.getByText('Group 1')).toBeInTheDocument()
    expect(item.getByRole('link', { name: 'https://ok.example' })).toHaveAttribute('href', 'https://ok.example/')
    expect(backupItems()[0].innerHTML).not.toContain('tracker.example')
  })

  it('a row with an unusable date is still listed, last, as "Unknown date"', async () => {
    const odd = { ...(await row('odd', 1, { name: 'b', groups: [WORK], auto: true })), created_at: 'not a date' }
    render(<Dashboard rows={[odd, await row('b1', 50, { name: 'b', groups: [WORK], auto: true })]} />)
    await waitFor(() => expect(backupItems()).toHaveLength(2))
    expect(within(backupItems()[1]).getByRole('heading', { level: 3 })).toHaveTextContent('Unknown date')
    expect(within(backupItems()[1]).getByRole('button', { name: 'Delete backup from an unknown date' })).toBeInTheDocument()
  })
})

describe('headings', () => {
  it('go h1 > h2 "Backups" > h3 per backup', async () => {
    render(<Dashboard rows={[await row('b1', 1, { name: 'b', groups: [WORK], auto: true })]} />)
    await waitFor(() => expect(backupItems()).toHaveLength(1))
    expect(within(backupsRegion()).getByRole('heading', { level: 2, name: 'Backups' })).toBeInTheDocument()
    expect(within(backupsRegion()).getAllByRole('heading', { level: 3 })).toHaveLength(1)
    expect(within(backupsRegion()).queryByRole('heading', { level: 4 })).toBeNull()
  })
})

describe('Pro pricing', () => {
  it('lists the automatic backups line in Pro only', () => {
    const ids = PRICING_TIERS.filter((t) => t.features.includes(AUTO_BACKUP_COPY.pricingFeature)).map((t) => t.id)
    expect(ids).toEqual(['pro'])
  })
})

describe('an account without cloud sync that still has rows (read-only)', () => {
  async function renderReadOnly() {
    const rows = [
      await row('b1', 3, { name: 'b', groups: [WORK, PLAY], auto: true }),
      await row('b2', 30, { name: 'b', groups: [PLAY], auto: true }),
      await row('s1', 4, { name: 'Mine', groups: [WORK] }),
    ]
    render(<Dashboard rows={rows} syncEnabled={false} />)
    await waitFor(() => expect(backupItems()).toHaveLength(2))
    return rows
  }

  it('lists the backups with Download and Delete, the read-only note and the upgrade link', async () => {
    await renderReadOnly()
    const region = within(backupsRegion())
    expect(region.getByText(AUTO_BACKUP_COPY.readOnlyNote)).toBeInTheDocument()
    expect(region.getByText(AUTO_BACKUP_COPY.upgradeDescription)).toBeInTheDocument()
    expect(region.getByRole('link', { name: 'Upgrade' })).toHaveAttribute('href', '/pricing')
    for (const item of backupItems()) {
      expect(within(item).getByRole('button', { name: /^Download backup from / })).toBeEnabled()
      expect(within(item).getByRole('button', { name: /^Delete backup from / })).toBeEnabled()
    }
    // Only reading and removing: every button in the section is one of these.
    const names = region.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)
    for (const name of names) expect(name).toMatch(/^(Download backup from |Delete backup from |Show contents)/)
    // The paid text about how backups are made and restored does not apply.
    expect(region.queryByText(/To restore one/)).toBeNull()
    expect(region.queryByText('No backups yet.')).toBeNull()
  })

  it('downloads a backup', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await renderReadOnly()
    fireEvent.click(within(backupItems()[0]).getByRole('button', { name: /^Download backup from / }))
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('deletes a backup, and the only request it makes is the DELETE', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await renderReadOnly()
    fireEvent.click(within(backupItems()[0]).getByRole('button', { name: /^Delete backup from / }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete this backup?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/b1', { method: 'DELETE' })
  })

  it('keeps the saved sessions listed with Restore and Delete, and the read-only note instead of the free-plan limit', async () => {
    await renderReadOnly()
    const section = within(sessionsSection())
    expect(await section.findByText('Mine')).toBeInTheDocument()
    expect(section.getByText(SAVED_SESSIONS_READ_ONLY_NOTE, { exact: false })).toBeInTheDocument()
    expect(section.getByRole('link', { name: 'Upgrade to Pro' })).toHaveAttribute('href', '/pricing')
    expect(section.queryByText(/Free plan: up to/)).toBeNull()
  })

  it('shows only the upgrade box, without the read-only note, when every row is a saved session', async () => {
    render(<Dashboard rows={[await row('s1', 4, { name: 'Mine', groups: [WORK] })]} syncEnabled={false} />)
    await within(sessionsSection()).findByText('Mine')
    const region = within(backupsRegion())
    expect(region.getByText(AUTO_BACKUP_COPY.upgradeDescription)).toBeInTheDocument()
    expect(region.queryByText(AUTO_BACKUP_COPY.readOnlyNote)).toBeNull()
    expect(region.queryByText('No backups yet.')).toBeNull()
    expect(backupItems()).toHaveLength(0)
  })

  it('an account with cloud sync gets no read-only notes', async () => {
    render(<Dashboard rows={[await row('b1', 3, { name: 'b', groups: [WORK], auto: true }), await row('s1', 4, { name: 'Mine', groups: [WORK] })]} />)
    await waitFor(() => expect(backupItems()).toHaveLength(1))
    expect(screen.queryByText(AUTO_BACKUP_COPY.readOnlyNote)).toBeNull()
    expect(screen.queryByText(SAVED_SESSIONS_READ_ONLY_NOTE, { exact: false })).toBeNull()
    expect(within(backupsRegion()).queryByRole('link', { name: 'Upgrade' })).toBeNull()
    expect(within(backupsRegion()).getByText(/To restore one/)).toBeInTheDocument()
  })
})
