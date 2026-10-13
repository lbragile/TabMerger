import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AUTO_BACKUP_DOWNLOAD_LIMITS as LIM, encryptBlob, generateDataKey } from '@tabmerger/shared'
import type { Group, Session } from '@/lib/types'
import {
  BACKUP_DOWNLOAD_MESSAGES,
  MAX_BACKUP_GROUPS,
  MAX_BACKUP_ROWS,
  buildDownloadedBackup,
  capDownloadedGroups,
  decryptAutoBackupRows,
  downloadAutoBackups,
  parseBackupCreatedAt,
  seedStateAfterDownload,
  selectBackupsToAdd,
  toDownloadedBackup,
} from '@/lib/autoBackupDownload'
import { AUTO_BACKUP_PENDING_DELETES_KEY, AUTO_BACKUP_STATE_KEY, AUTO_BACKUP_STORE_GUARD_KEY, LAST_USER_ID_KEY } from '@/lib/syncSettingKeys'

const h = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  sessions: [] as unknown[],
  auth: { user: { id: 'user-1' } } as unknown,
  gate: { key: null } as { key: CryptoKey | null; reason?: string },
  rows: [] as unknown[],
  fetchError: null as unknown,
  fetchThrows: false,
  remoteDeleteOk: true,
  limit: 0,
  signal: undefined as unknown,
  order: null as unknown,
  eq: null as unknown,
  from: '',
  saveFails: false,
  signedInCalls: 0,
  beforeSignedIn: null as null | ((n: number) => void),
  afterFetch: null as null | (() => void),
  beforeCommit: null as null | (() => void),
  commits: [] as unknown[],
  reads: [] as string[],
  afterGetSessions: null as null | (() => void),
}))

vi.mock('@/lib/localDb', () => ({
  getSessions: vi.fn(async () => {
    h.reads.push('sessions')
    const snapshot = [...h.sessions]
    h.afterGetSessions?.()
    return snapshot
  }),
  // mirrors the real one: nothing at all is written unless the guard setting still equals the guard value
  commitSessionsIfGuardHolds: vi.fn(
    async (
      guard: { key: string; value: unknown },
      changes: { putSessions?: { id: string }[]; deleteSessionIds?: string[]; settings?: Record<string, unknown>; updateSettings?: Record<string, (v: unknown) => unknown> }
    ) => {
      h.beforeCommit?.()
      if (!h.settings.has(guard.key) || h.settings.get(guard.key) !== guard.value) return false
      if (h.saveFails) throw new Error('idb full')
      // the pending-delete bookkeeping (updateSettings only) is not a "sessions commit"
      if (!changes.updateSettings || changes.putSessions) h.commits.push(changes)
      for (const [k, fn] of Object.entries(changes.updateSettings ?? {})) h.settings.set(k, fn(h.settings.get(k)))
      const del = new Set(changes.deleteSessionIds ?? [])
      h.sessions = [...h.sessions.filter((x) => !del.has((x as { id: string }).id)), ...(changes.putSessions ?? [])]
      for (const [k, v] of Object.entries(changes.settings ?? {})) h.settings.set(k, v)
      return true
    }
  ),
  getSetting: vi.fn(async (k: string, d: unknown) => {
    if (k === 'autoBackupPendingRemoteDeletes') h.reads.push('pending')
    return h.settings.has(k) ? h.settings.get(k) : d
  }),
  setSetting: vi.fn(async (k: string, v: unknown) => void h.settings.set(k, v)),
  deleteSession: vi.fn(),
  getGroupsState: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: h.auth } })) },
    from: (t: string) => {
      h.from = t
      const b = {
        select: () => b,
        eq: (...a: unknown[]) => ((h.eq = a), b),
        order: (...a: unknown[]) => ((h.order = a), b),
        limit: (n: number) => ((h.limit = n), b),
        abortSignal: async (signal: unknown) => {
          h.signal = signal
          if (h.fetchThrows) throw new Error('network')
          const result = { data: h.fetchError ? null : h.rows, error: h.fetchError }
          h.afterFetch?.()
          return result
        },
      }
      return b
    },
  },
}))
vi.mock('@/lib/contentUploadKey', () => ({ getContentUploadKey: vi.fn(async (_expected?: string) => h.gate) }))
vi.mock('@/lib/sessionUpload', () => ({
  isSignedInAs: vi.fn(async (id: string) => {
    h.beforeSignedIn?.(++h.signedInCalls)
    return (h.auth as { user: { id: string } } | null)?.user.id === id
  }),
  pushSessionToSupabase: vi.fn(),
  deleteRemoteSessions: vi.fn(async () => h.remoteDeleteOk),
}))

const NOW = Date.UTC(2030, 5, 15, 12, 0, 0)
const DAY = 86_400_000
const validGroup = (id = 'g1'): Group => ({
  id,
  name: 'Group ' + id,
  color: 'rgba(1, 2, 3, 1)',
  updatedAt: 1,
  windows: [{ id: 1, incognito: false, focused: false, tabs: [{ id: 0, title: 'T', url: 'https://example.com/a' }] }],
})
const content = (extra: Record<string, unknown> = {}) => ({ name: 'Automatic backup · x', groups: [validGroup()], auto: true, ...extra })
const local = (id: string, createdAt: number, auto = true): Session => ({ id, name: id, groups: [validGroup()], createdAt, ...(auto ? { auto: true } : {}) })

let key: CryptoKey
const rowFor = async (id: string, body: unknown, createdAt: number | string = NOW - DAY) => {
  const { iv, ct } = await encryptBlob(key, body)
  return { id, groups: { v: 1, iv, ct }, created_at: typeof createdAt === 'number' ? new Date(createdAt).toISOString() : createdAt }
}

beforeEach(async () => {
  key = await generateDataKey()
  h.settings.clear()
  h.sessions = []
  h.auth = { user: { id: 'user-1' } }
  h.gate = { key }
  h.rows = []
  h.fetchError = null
  h.fetchThrows = false
  h.remoteDeleteOk = true
  h.saveFails = false
  h.signedInCalls = 0
  h.beforeSignedIn = null
  h.afterFetch = null
  h.beforeCommit = null
  h.commits = []
  h.reads = []
  h.afterGetSessions = null
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('parseBackupCreatedAt', () => {
  it('accepts ISO strings and numbers within bounds', () => {
    expect(parseBackupCreatedAt('2030-06-14T12:00:00.000Z', NOW)).toBe(NOW - DAY)
    expect(parseBackupCreatedAt(NOW - 5, NOW)).toBe(NOW - 5)
  })
  it('allows up to a day of clock skew into the future, no more', () => {
    expect(parseBackupCreatedAt(NOW + DAY, NOW)).toBe(NOW + DAY)
    expect(parseBackupCreatedAt(NOW + DAY + 1, NOW)).toBeNull()
  })
  it('rejects anything older than 2020-01-01', () => {
    expect(parseBackupCreatedAt(Date.UTC(2020, 0, 1), NOW)).toBe(Date.UTC(2020, 0, 1))
    expect(parseBackupCreatedAt(Date.UTC(2019, 11, 31), NOW)).toBeNull()
    expect(parseBackupCreatedAt(0, NOW)).toBeNull()
  })
  it.each([[null], [undefined], [{}], [true], ['not a date'], [NaN], [Infinity], ['']])('rejects %j', (v) => {
    expect(parseBackupCreatedAt(v, NOW)).toBeNull()
  })
})

describe('toDownloadedBackup', () => {
  const ok = () => toDownloadedBackup('abc123', NOW - DAY, content(), NOW)

  it('builds an auto session from valid content', () => {
    expect(ok()).toMatchObject({ id: 'abc123', name: 'Automatic backup · x', createdAt: NOW - DAY, auto: true })
    expect(ok()!.groups).toHaveLength(1)
  })

  it.each([['space', 'a b'], ['slash', '../x'], ['empty', ''], ['number', 4], ['long', 'a'.repeat(65)]])('rejects a bad id (%s)', (_n, id) => {
    expect(toDownloadedBackup(id, NOW - DAY, content(), NOW)).toBeNull()
  })

  it.each([
    ['null', null],
    ['array', []],
    ['string', 'x'],
    ['auto missing', { groups: [validGroup()] }],
    ['auto string "true"', content({ auto: 'true' })],
    ['auto 1', content({ auto: 1 })],
    ['auto false', content({ auto: false })],
    ['groups not an array', content({ groups: 'x' })],
    ['no groups', content({ groups: [] })],
    ['too many groups', content({ groups: Array.from({ length: MAX_BACKUP_GROUPS + 1 }, () => validGroup()) })],
    ['all groups invalid', content({ groups: [{ nope: 1 }, 5] })],
  ])('rejects content: %s', (_n, c) => {
    expect(toDownloadedBackup('abc123', NOW - DAY, c, NOW)).toBeNull()
  })

  it('accepts exactly MAX_BACKUP_GROUPS', () => {
    const b = toDownloadedBackup('abc123', NOW - DAY, content({ groups: Array.from({ length: MAX_BACKUP_GROUPS }, (_, i) => validGroup(`g${i}`)) }), NOW)
    expect(b).not.toBeNull()
  })

  it('rejects an implausible date', () => {
    expect(toDownloadedBackup('abc123', 'garbage', content(), NOW)).toBeNull()
    expect(toDownloadedBackup('abc123', NOW + 3 * DAY, content(), NOW)).toBeNull()
    expect(toDownloadedBackup('abc123', 1000, content(), NOW)).toBeNull()
  })

  it('cuts a long name to 200 chars and rebuilds a missing, blank or non-string name from the date', () => {
    expect(toDownloadedBackup('abc123', NOW - DAY, content({ name: 'n'.repeat(500) }), NOW)!.name).toHaveLength(200)
    for (const name of [undefined, '', '   ', 5, null]) {
      expect(toDownloadedBackup('abc123', NOW - DAY, content({ name }), NOW)!.name.startsWith('Automatic backup · ')).toBe(true)
    }
  })

  it('sends groups through the import sanitiser: script URLs are dropped, ids are strings', () => {
    const bad = validGroup('g1')
    bad.windows[0].tabs.push({ id: 0, title: 'evil', url: 'javascript:alert(1)' })
    const b = toDownloadedBackup('abc123', NOW - DAY, content({ groups: [bad] }), NOW)!
    const urls = b.groups.flatMap((g) => g.windows.flatMap((w) => w.tabs.map((t) => t.url)))
    expect(urls).toEqual(['https://example.com/a'])
  })

  it('does not copy extra fields from the payload onto the session', () => {
    const b = toDownloadedBackup('abc123', NOW - DAY, content({ evil: 'x', description: 'd' }), NOW)!
    expect(Object.keys(b).sort()).toEqual(['auto', 'createdAt', 'groups', 'id', 'name'])
  })
})

describe('selectBackupsToAdd', () => {
  const dl = (id: string, t: number) => local(id, t)

  it('adds downloaded backups that are not local', () => {
    expect(selectBackupsToAdd([], [dl('a', 1), dl('b', 2)], []).map((s) => s.id).sort()).toEqual(['a', 'b'])
  })
  it('never adds an id that is already local (no overwrite)', () => {
    expect(selectBackupsToAdd([local('a', 1)], [dl('a', 99)], [])).toEqual([])
  })
  it('never adds an id with a pending delete', () => {
    expect(selectBackupsToAdd([], [dl('a', 1), dl('b', 2)], ['a']).map((s) => s.id)).toEqual(['b'])
    expect(selectBackupsToAdd([], [dl('a', 1)], new Set(['a']))).toEqual([])
  })
  it('dedupes repeated ids and drops non-auto entries', () => {
    const manual = { ...dl('m', 5), auto: undefined }
    expect(selectBackupsToAdd([], [dl('a', 1), dl('a', 1), manual], []).map((s) => s.id)).toEqual(['a'])
  })
  it('only adds those inside the newest 10 of local + downloaded', () => {
    const localOnes = Array.from({ length: 8 }, (_, i) => local(`l${i}`, 1000 + i))
    const downloaded = [dl('new', 5000), dl('mid', 1003.5), dl('old', 1)]
    const added = selectBackupsToAdd(localOnes, downloaded, []).map((s) => s.id).sort()
    expect(added).toEqual(['mid', 'new'])
  })
  it('manual local sessions never take up retention slots', () => {
    const manual = Array.from({ length: 20 }, (_, i) => local(`m${i}`, 9000 + i, false))
    expect(selectBackupsToAdd(manual, [dl('a', 1)], []).map((s) => s.id)).toEqual(['a'])
  })
  it('never returns more than keep, and keep <= 0 adds nothing', () => {
    const many = Array.from({ length: 15 }, (_, i) => dl(`d${i}`, i + 1))
    expect(selectBackupsToAdd([], many, [])).toHaveLength(10)
    expect(selectBackupsToAdd([], many, [], 3).map((s) => s.id)).toEqual(['d14', 'd13', 'd12'])
    expect(selectBackupsToAdd([], many, [], 0)).toEqual([])
    expect(selectBackupsToAdd([], many, [], -1)).toEqual([])
  })
})

describe('seedStateAfterDownload', () => {
  const state = { lastBackupAt: 5, fingerprint: 'f', lastBackupId: 'x' }
  it('does not touch an existing state', () => {
    expect(seedStateAfterDownload(state, [local('a', 9)])).toBeNull()
  })
  it('does nothing when nothing was added', () => {
    expect(seedStateAfterDownload(null, [])).toBeNull()
  })
  it('seeds time + id of the newest added with an empty fingerprint', () => {
    expect(seedStateAfterDownload(null, [local('a', 1), local('c', 30), local('b', 20)])).toEqual({ lastBackupAt: 30, fingerprint: '', lastBackupId: 'c' })
  })
})

describe('decryptAutoBackupRows', () => {
  it('returns nothing for a non-array', async () => {
    expect(await decryptAutoBackupRows(null, key, new Set(), NOW)).toEqual({ backups: [], unreadable: 0, dropped: 0 })
    expect(await decryptAutoBackupRows({}, key, new Set(), NOW)).toEqual({ backups: [], unreadable: 0, dropped: 0 })
  })

  it('keeps valid auto backups; skips manual sessions, plaintext rows, bad ids, skipIds and non-objects', async () => {
    const rows = [
      await rowFor('good', content()),
      await rowFor('manual', { name: 'm', groups: [validGroup()] }),
      { id: 'plain', groups: [validGroup()], created_at: new Date(NOW - DAY).toISOString() },
      await rowFor('bad id', content()),
      await rowFor('skipme', content()),
      null,
      'str',
      { id: 'noblob', created_at: 'x' },
    ]
    const out = await decryptAutoBackupRows(rows, key, new Set(['skipme']), NOW)
    expect(out.backups.map((b) => b.id)).toEqual(['good'])
    expect(out.unreadable).toBe(0)
  })

  it('counts rows that fail to decrypt (wrong key) without throwing', async () => {
    const other = await generateDataKey()
    const rows = [await rowFor('good', content()), { ...(await rowFor('wrong', content())) }]
    const { iv, ct } = await encryptBlob(other, content())
    rows[1] = { id: 'wrong', groups: { v: 1, iv, ct }, created_at: new Date(NOW - DAY).toISOString() }
    const out = await decryptAutoBackupRows(rows, key, new Set(), NOW)
    expect(out.backups.map((b) => b.id)).toEqual(['good'])
    expect(out.unreadable).toBe(1)
  })

  it('reads at most MAX_BACKUP_ROWS rows', async () => {
    const one = await rowFor('r0', content())
    const rows = Array.from({ length: MAX_BACKUP_ROWS + 20 }, (_, i) => ({ ...one, id: `r${i}` }))
    const out = await decryptAutoBackupRows(rows, key, new Set(), NOW)
    expect(out.backups).toHaveLength(MAX_BACKUP_ROWS)
  })
})

describe('downloadAutoBackups', () => {
  it('blocked signed-out', async () => {
    h.auth = null
    expect(await downloadAutoBackups(NOW)).toEqual({ status: 'blocked', reason: 'signed-out' })
  })

  it('blocked account-mismatch', async () => {
    h.settings.set(LAST_USER_ID_KEY, 'user-2')
    expect(await downloadAutoBackups(NOW)).toEqual({ status: 'blocked', reason: 'account-mismatch' })
  })

  it.each([
    ['no-key', 'no-key'],
    ['unknown', 'key-unknown'],
    ['locked', 'locked'],
  ])('blocked when the key gate says %s -> %s', async (gateReason, reason) => {
    h.gate = { key: null, reason: gateReason }
    expect(await downloadAutoBackups(NOW)).toEqual({ status: 'blocked', reason })
  })

  it('blocked fetch-failed on a query error, and nothing is written', async () => {
    h.fetchError = { message: 'x' }
    h.sessions = [local('keep', 5)]
    expect(await downloadAutoBackups(NOW)).toEqual({ status: 'blocked', reason: 'fetch-failed' })
    expect(h.sessions).toHaveLength(1)
    expect(h.settings.has(AUTO_BACKUP_STATE_KEY)).toBe(false)
  })

  it('a thrown request is fetch-failed, never an exception', async () => {
    h.fetchThrows = true
    expect(await downloadAutoBackups(NOW)).toEqual({ status: 'blocked', reason: 'fetch-failed' })
  })

  it('every blocked reason has a message', () => {
    for (const r of ['signed-out', 'account-mismatch', 'no-key', 'key-unknown', 'locked', 'fetch-failed', 'identity-changed'] as const) {
      expect(BACKUP_DOWNLOAD_MESSAGES[r].length).toBeGreaterThan(10)
    }
  })

  it('busy when the lock is held', async () => {
    const request = vi.fn(async (_n: string, _o: unknown, cb: (l: unknown) => Promise<unknown>) => cb(null))
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    expect(await downloadAutoBackups(NOW)).toEqual({ status: 'busy' })
    vi.unstubAllGlobals()
  })

  it('queries the signed-in user\'s newest 100 sessions rows', async () => {
    await downloadAutoBackups(NOW)
    expect(h.from).toBe('sessions')
    expect(h.eq).toEqual(['user_id', 'user-1'])
    expect(h.order).toEqual(['created_at', { ascending: false }])
    expect(h.limit).toBe(100)
  })

  it('adds missing automatic backups, counts them, and seeds the state when the device had none', async () => {
    h.rows = [await rowFor('b1', content(), NOW - 2 * DAY), await rowFor('b2', content(), NOW - DAY)]
    const out = await downloadAutoBackups(NOW)
    expect(out).toEqual({ status: 'done', added: 2, inAccount: 2, unreadable: 0, dropped: 0, removed: 0 })
    expect((h.sessions as Session[]).map((s) => s.id).sort()).toEqual(['b1', 'b2'])
    expect(h.settings.get(AUTO_BACKUP_STATE_KEY)).toEqual({ lastBackupAt: NOW - DAY, fingerprint: '', lastBackupId: 'b2' })
  })

  it('what is added carries the local-only uploadedAt marker (it is on the server by definition)', async () => {
    h.rows = [await rowFor('b1', content(), NOW - 2 * DAY)]
    await downloadAutoBackups(NOW)
    expect((h.sessions as Session[])[0].uploadedAt).toBe(NOW)
  })

  it('the download claims the store for the signed-in user before it writes', async () => {
    h.rows = [await rowFor('b1', content())]
    await downloadAutoBackups(NOW)
    expect(h.settings.get(AUTO_BACKUP_STORE_GUARD_KEY)).toBe('user-1')
  })

  it('does not overwrite or remove local backups; existing state is not touched; known rows still count as in the account', async () => {
    const existingState = { lastBackupAt: 7, fingerprint: 'fp', lastBackupId: 'l1' }
    h.settings.set(AUTO_BACKUP_STATE_KEY, existingState)
    h.sessions = [local('l1', NOW - 3 * DAY), local('manual1', 1, false)]
    h.rows = [await rowFor('l1', content({ name: 'server version' })), await rowFor('b1', content(), NOW - DAY)]
    const out = await downloadAutoBackups(NOW)
    expect(out).toEqual({ status: 'done', added: 1, inAccount: 2, unreadable: 0, dropped: 0, removed: 0 })
    const ids = (h.sessions as Session[]).map((s) => s.id)
    expect(ids).toEqual(expect.arrayContaining(['l1', 'manual1', 'b1']))
    expect((h.sessions as Session[]).find((s) => s.id === 'l1')!.name).toBe('l1')
    expect(h.settings.get(AUTO_BACKUP_STATE_KEY)).toEqual(existingState)
  })

  it('a backup the user deleted and the server has not confirmed stays deleted', async () => {
    h.remoteDeleteOk = false
    h.settings.set(AUTO_BACKUP_PENDING_DELETES_KEY, ['gone'])
    h.rows = [await rowFor('gone', content()), await rowFor('keepme', content())]
    const out = await downloadAutoBackups(NOW)
    expect(out).toMatchObject({ status: 'done', added: 1 })
    expect((h.sessions as Session[]).map((s) => s.id)).toEqual(['keepme'])
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual(['gone'])
  })

  it('pending deletes are retried first and cleared once confirmed', async () => {
    h.settings.set(AUTO_BACKUP_PENDING_DELETES_KEY, ['gone'])
    await downloadAutoBackups(NOW)
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual([])
  })

  it('unreadable rows are counted, not thrown, and do not block the readable ones', async () => {
    const other = await generateDataKey()
    const { iv, ct } = await encryptBlob(other, content())
    h.rows = [{ id: 'bad', groups: { v: 1, iv, ct }, created_at: new Date(NOW - DAY).toISOString() }, await rowFor('good', content())]
    expect(await downloadAutoBackups(NOW)).toEqual({ status: 'done', added: 1, inAccount: 1, unreadable: 1, dropped: 0, removed: 0 })
  })

  it('a failure while saving is reported as blocked fetch-failed', async () => {
    h.rows = [await rowFor('b1', content())]
    h.saveFails = true
    expect(await downloadAutoBackups(NOW)).toEqual({ status: 'blocked', reason: 'fetch-failed' })
    expect(h.settings.has(AUTO_BACKUP_STATE_KEY)).toBe(false)
  })

  it('a non-array response is a failed fetch, never "the account has nothing" (so nothing is removed)', async () => {
    h.sessions = [{ ...local('up', NOW - DAY), uploadedAt: 1 }]
    h.rows = null as unknown as unknown[]
    expect(await downloadAutoBackups(NOW)).toEqual({ status: 'blocked', reason: 'fetch-failed' })
    expect((h.sessions as Session[]).map((s) => s.id)).toEqual(['up'])
  })

  it('does not seed the state when nothing was added', async () => {
    await downloadAutoBackups(NOW)
    expect(h.settings.has(AUTO_BACKUP_STATE_KEY)).toBe(false)
  })

  it('adds only within the newest 10 of local + downloaded', async () => {
    h.sessions = Array.from({ length: 10 }, (_, i) => local(`l${i}`, NOW - i * 1000))
    h.rows = [await rowFor('older', content(), NOW - 30 * DAY)]
    expect(await downloadAutoBackups(NOW)).toMatchObject({ status: 'done', added: 0 })
  })
})

describe('downloadAutoBackups: identity', () => {
  const stored = () => (h.sessions as Session[]).map((s) => s.id)

  it.each([1, 2, 3])('the account changes at identity check %i: nothing is stored, nothing is removed', async (n) => {
    h.sessions = [{ ...local('keep', NOW - 2 * DAY), uploadedAt: 1 }]
    h.rows = [await rowFor('b1', content())] // the account has b1 but not "keep"
    h.beforeSignedIn = (call) => {
      if (call === n) h.auth = { user: { id: 'user-2' } }
    }
    expect(await downloadAutoBackups(NOW)).toEqual({ status: 'blocked', reason: 'identity-changed' })
    expect(stored()).toEqual(['keep'])
    expect(h.settings.has(AUTO_BACKUP_STATE_KEY)).toBe(false)
  })

  it('the user signs out after the fetch: the empty answer RLS gives a signed-out client is never read as "everything was deleted"', async () => {
    h.sessions = [{ ...local('keep', NOW - 2 * DAY), uploadedAt: 1 }]
    h.rows = [] // what a signed-out client sees
    h.afterFetch = () => void (h.auth = null)
    expect(await downloadAutoBackups(NOW)).toEqual({ status: 'blocked', reason: 'identity-changed' })
    expect(stored()).toEqual(['keep'])
  })

  it('a wipe lands between the last identity check and the commit: nothing is written (backups and seeded state together)', async () => {
    h.rows = [await rowFor('b1', content())]
    h.beforeCommit = () => void h.settings.delete(AUTO_BACKUP_STORE_GUARD_KEY)
    expect(await downloadAutoBackups(NOW)).toEqual({ status: 'blocked', reason: 'identity-changed' })
    expect(stored()).toEqual([])
    expect(h.settings.has(AUTO_BACKUP_STATE_KEY)).toBe(false)
  })

  it('the store is claimed for another account after the fetch: refused', async () => {
    h.rows = [await rowFor('b1', content())]
    h.afterFetch = () => void h.settings.set(LAST_USER_ID_KEY, 'user-2')
    expect(await downloadAutoBackups(NOW)).toEqual({ status: 'blocked', reason: 'identity-changed' })
    expect(stored()).toEqual([])
  })
})

describe('downloadAutoBackups: absence on the server never deletes a local backup', () => {
  const ids = () => (h.sessions as Session[]).map((s) => s.id)
  const filler = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `other${i}`, groups: 'x', created_at: 'x' }))

  it('keeps an uploaded local backup missing from a complete answer; removed is 0', async () => {
    h.sessions = [{ ...local('gone', NOW - 3 * DAY), uploadedAt: 1 }, local('pending', NOW - 2 * DAY), local('manual', 1, false)]
    h.rows = [await rowFor('b1', content(), NOW - DAY)]
    const out = await downloadAutoBackups(NOW)
    expect(out).toMatchObject({ status: 'done', added: 1, removed: 0 })
    expect(ids().sort()).toEqual(['b1', 'gone', 'manual', 'pending'])
  })

  it('keeps it when the answer is cut off by the row limit', async () => {
    h.sessions = [{ ...local('gone', NOW - 3 * DAY), uploadedAt: 1 }]
    h.rows = filler(MAX_BACKUP_ROWS)
    expect(await downloadAutoBackups(NOW)).toMatchObject({ status: 'done', removed: 0 })
    expect(ids()).toEqual(['gone'])
  })

  it('keeps it when the answer is one row under the limit (a complete answer no longer removes anything)', async () => {
    h.sessions = [{ ...local('gone', NOW - 3 * DAY), uploadedAt: 1 }]
    h.rows = filler(MAX_BACKUP_ROWS - 1)
    expect(await downloadAutoBackups(NOW)).toMatchObject({ removed: 0 })
    expect(ids()).toEqual(['gone'])
  })

  it('keeps a never-uploaded backup when the account has no rows at all', async () => {
    h.sessions = [local('offline', NOW - DAY)]
    h.rows = []
    expect(await downloadAutoBackups(NOW)).toMatchObject({ removed: 0 })
    expect(ids()).toEqual(['offline'])
  })

  it('keeps every uploaded backup on an empty answer', async () => {
    h.sessions = [{ ...local('a', NOW - DAY), uploadedAt: 1 }, { ...local('b', NOW - 2 * DAY), uploadedAt: 1 }]
    h.rows = []
    expect(await downloadAutoBackups(NOW)).toEqual({ status: 'done', added: 0, inAccount: 0, unreadable: 0, dropped: 0, removed: 0 })
    expect(ids().sort()).toEqual(['a', 'b'])
  })

  it('a failed fetch removes nothing', async () => {
    h.sessions = [{ ...local('a', NOW - DAY), uploadedAt: 1 }]
    h.fetchError = { message: 'x' }
    await downloadAutoBackups(NOW)
    expect(ids()).toEqual(['a'])
  })

  it('the one commit adds backups and carries deleteSessionIds: []', async () => {
    h.sessions = [{ ...local('gone', NOW - 3 * DAY), uploadedAt: 1 }]
    h.rows = [await rowFor('b1', content(), NOW - DAY)]
    await downloadAutoBackups(NOW)
    expect(h.commits).toHaveLength(1)
    expect(h.commits[0]).toMatchObject({ deleteSessionIds: [] })
  })

  it('does not commit at all when nothing is added', async () => {
    h.sessions = [{ ...local('gone', NOW - 3 * DAY), uploadedAt: 1 }]
    await downloadAutoBackups(NOW)
    expect(h.commits).toHaveLength(0)
    expect(ids()).toEqual(['gone'])
  })

  it('the select request carries an abort signal', async () => {
    await downloadAutoBackups(NOW)
    expect(h.signal).toBeInstanceOf(AbortSignal)
  })

  it('asks for the key of the claimed user only', async () => {
    const { getContentUploadKey } = await import('@/lib/contentUploadKey')
    await downloadAutoBackups(NOW)
    expect(getContentUploadKey).toHaveBeenCalledWith('user-1')
  })
})

describe('capDownloadedGroups', () => {
  const tab = (url = 'https://e.com/x') => ({ id: 0, title: 't', url })
  const grp = (windows: unknown[], extra: Record<string, unknown> = {}) => ({ ...validGroup('g1'), windows, ...extra }) as unknown as Group
  const win = (tabs: unknown[], extra: Record<string, unknown> = {}) => ({ id: 1, incognito: false, focused: false, tabs, ...extra })

  it('leaves content at every limit untouched', () => {
    const g = grp(
      Array.from({ length: LIM.windowsPerGroup }, (_, i) => win(i === 0 ? Array.from({ length: LIM.tabsPerWindow }, () => tab('https://e.com/' + 'a'.repeat(LIM.urlLength - 14))) : [tab()]))
    )
    const out = capDownloadedGroups([g])
    expect(out.dropped).toBe(0)
    expect(out.groups[0].windows).toHaveLength(LIM.windowsPerGroup)
    expect(out.groups[0].windows[0].tabs).toHaveLength(LIM.tabsPerWindow)
  })

  it('drops windows beyond the limit and counts them', () => {
    const g = grp(Array.from({ length: LIM.windowsPerGroup + 1 }, () => win([tab()])))
    const out = capDownloadedGroups([g])
    expect(out.groups[0].windows).toHaveLength(LIM.windowsPerGroup)
    expect(out.dropped).toBe(1)
  })

  it('drops tabs beyond the limit and counts them', () => {
    const out = capDownloadedGroups([grp([win(Array.from({ length: LIM.tabsPerWindow + 3 }, () => tab()))])])
    expect(out.groups[0].windows[0].tabs).toHaveLength(LIM.tabsPerWindow)
    expect(out.dropped).toBe(3)
  })

  it('an address of exactly the limit stays, one longer is left out and counted', () => {
    const base = 'https://e.com/'
    const ok = base + 'a'.repeat(LIM.urlLength - base.length)
    const out = capDownloadedGroups([grp([win([tab(ok), tab(ok + 'a')])])])
    expect(out.groups[0].windows[0].tabs.map((t) => t.url)).toEqual([ok])
    expect(out.dropped).toBe(1)
  })

  it('cuts names, titles and notes to their limits (not shorter, exactly at the limit)', () => {
    const t = { ...tab(), title: 'x'.repeat(LIM.titleLength + 1), customTitle: 'y'.repeat(LIM.titleLength + 1), note: 'n'.repeat(LIM.noteLength + 1) }
    const g = grp([win([t], { name: 'w'.repeat(LIM.nameLength + 1), note: 'n'.repeat(LIM.noteLength + 1) })], { name: 'g'.repeat(LIM.nameLength + 1), note: 'n'.repeat(LIM.noteLength + 1) })
    const out = capDownloadedGroups([g]).groups[0]
    expect(out.name).toHaveLength(LIM.nameLength)
    expect(out.note).toHaveLength(LIM.noteLength)
    expect(out.windows[0].name).toHaveLength(LIM.nameLength)
    expect(out.windows[0].note).toHaveLength(LIM.noteLength)
    expect(out.windows[0].tabs[0].title).toHaveLength(LIM.titleLength)
    expect(out.windows[0].tabs[0].customTitle).toHaveLength(LIM.titleLength)
    expect(out.windows[0].tabs[0].note).toHaveLength(LIM.noteLength)
    const exact = capDownloadedGroups([grp([win([{ ...tab(), title: 'x'.repeat(LIM.titleLength) }])], { name: 'g'.repeat(LIM.nameLength) })]).groups[0]
    expect(exact.name).toHaveLength(LIM.nameLength)
    expect(exact.windows[0].tabs[0].title).toHaveLength(LIM.titleLength)
  })

  it('replaces a group id that is not a short URL-safe id, keeps a good one', () => {
    const out = capDownloadedGroups([grp([win([tab()])], { id: 'has space/../x' }), grp([win([tab()])], { id: 'good-id_1' })]).groups
    expect(out[0].id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(out[0].id).not.toBe('has space/../x')
    expect(out[1].id).toBe('good-id_1')
  })

  it('does not add fields that were absent', () => {
    const out = capDownloadedGroups([grp([win([tab()])])]).groups[0]
    expect('note' in out).toBe(false)
    expect('customTitle' in out.windows[0].tabs[0]).toBe(false)
  })
})

describe('buildDownloadedBackup', () => {
  it('returns the backup and how many tabs the limits left out', () => {
    const g = validGroup('g1')
    g.windows[0].tabs.push({ id: 0, title: 'long', url: 'https://e.com/' + 'a'.repeat(LIM.urlLength) })
    const built = buildDownloadedBackup('abc123', NOW - DAY, content({ groups: [g] }), NOW)!
    expect(built.dropped).toBe(1)
    expect(built.backup.groups[0].windows[0].tabs).toHaveLength(1)
  })
  it('returns null for what toDownloadedBackup rejects', () => {
    expect(buildDownloadedBackup('bad id', NOW - DAY, content(), NOW)).toBeNull()
    expect(buildDownloadedBackup('abc123', NOW - DAY, content({ auto: false }), NOW)).toBeNull()
  })
  it('accepts exactly MAX_BACKUP_GROUPS and rejects one more', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => validGroup(`g${i}`))
    expect(buildDownloadedBackup('abc123', NOW - DAY, content({ groups: many(LIM.groupsPerBackup) }), NOW)).not.toBeNull()
    expect(buildDownloadedBackup('abc123', NOW - DAY, content({ groups: many(LIM.groupsPerBackup + 1) }), NOW)).toBeNull()
  })
})

describe('decryptAutoBackupRows: dropped', () => {
  it('sums the tabs the limits left out across rows', async () => {
    const g = validGroup('g1')
    g.windows[0].tabs.push({ id: 0, title: 'long', url: 'https://e.com/' + 'a'.repeat(LIM.urlLength) })
    const rows = [await rowFor('r1', content({ groups: [g] })), await rowFor('r2', content({ groups: [g] }))]
    const out = await decryptAutoBackupRows(rows, key, new Set(), NOW)
    expect(out.backups).toHaveLength(2)
    expect(out.dropped).toBe(2)
  })
})

describe('downloadAutoBackups: list refresh is the caller\'s concern, state is idempotent', () => {
  it('running twice in a row (a double run on mount) adds once and the second run adds nothing', async () => {
    h.rows = [await rowFor('b1', content(), NOW - 2 * DAY), await rowFor('b2', content(), NOW - DAY)]
    const first = await downloadAutoBackups(NOW)
    const second = await downloadAutoBackups(NOW)
    expect(first).toMatchObject({ added: 2 })
    expect(second).toMatchObject({ added: 0, inAccount: 2, removed: 0 })
    expect((h.sessions as Session[]).map((s) => s.id).sort()).toEqual(['b1', 'b2'])
  })

  it('two overlapping runs: the lock lets one proceed and answers busy to the other', async () => {
    h.rows = [await rowFor('b1', content())]
    const [a, b] = await Promise.all([downloadAutoBackups(NOW), downloadAutoBackups(NOW)])
    const statuses = [a.status, b.status].sort()
    // with jsdom there is no navigator.locks: the in-process flag applies
    expect(statuses).toEqual(['busy', 'done'])
    expect((h.sessions as Session[]).map((s) => s.id)).toEqual(['b1'])
  })
})


describe('downloadAutoBackups: a delete made while the fetch is in flight', () => {
  const ids = () => (h.sessions as Session[]).map((s) => s.id)

  it('reads the local sessions first, then the pending list (so a delete between the two reads is seen)', async () => {
    h.rows = [await rowFor('b1', content())]
    await downloadAutoBackups(NOW)
    const afterFlush = h.reads.slice(h.reads.indexOf('sessions'))
    expect(afterFlush[0]).toBe('sessions')
    expect(afterFlush).toContain('pending')
    expect(afterFlush.indexOf('pending')).toBeGreaterThan(afterFlush.indexOf('sessions'))
  })

  it('a backup deleted during the fetch (not in the first pending read, not in sessions, in the second pending read) is not added', async () => {
    h.rows = [await rowFor('deleted-now', content(), NOW - 2 * DAY), await rowFor('keepme', content(), NOW - DAY)]
    // the user deletes it right after the sessions were read: only the second pending read sees the id
    h.afterGetSessions = () => void h.settings.set(AUTO_BACKUP_PENDING_DELETES_KEY, ['deleted-now'])
    const out = await downloadAutoBackups(NOW)
    expect(out).toMatchObject({ status: 'done', added: 1 })
    expect(ids()).toEqual(['keepme'])
  })

  it('a backup deleted during the fetch is not even decrypted (its row counts nothing as unreadable)', async () => {
    const other = await generateDataKey()
    const { iv, ct } = await encryptBlob(other, content())
    h.rows = [{ id: 'deleted-now', groups: { v: 1, iv, ct }, created_at: new Date(NOW - DAY).toISOString() }]
    h.afterGetSessions = () => void h.settings.set(AUTO_BACKUP_PENDING_DELETES_KEY, ['deleted-now'])
    expect(await downloadAutoBackups(NOW)).toMatchObject({ status: 'done', added: 0, unreadable: 0 })
  })

  it('an id only in the FIRST pending read (a delete the server did not confirm) is still blocked', async () => {
    h.remoteDeleteOk = false
    h.settings.set(AUTO_BACKUP_PENDING_DELETES_KEY, ['early'])
    h.rows = [await rowFor('early', content()), await rowFor('late', content())]
    const out = await downloadAutoBackups(NOW)
    expect(out).toMatchObject({ status: 'done', added: 1 })
    expect(ids()).toEqual(['late'])
  })

  it('both lists are blocked together (union)', async () => {
    h.remoteDeleteOk = false
    h.settings.set(AUTO_BACKUP_PENDING_DELETES_KEY, ['early'])
    h.rows = [await rowFor('early', content()), await rowFor('late', content()), await rowFor('fine', content())]
    h.afterGetSessions = () => void h.settings.set(AUTO_BACKUP_PENDING_DELETES_KEY, ['early', 'late'])
    expect(await downloadAutoBackups(NOW)).toMatchObject({ status: 'done', added: 1 })
    expect(ids()).toEqual(['fine'])
  })
})
