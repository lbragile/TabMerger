import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AUTO_BACKUP_FREE_RECHECK_MS, AUTO_BACKUP_RETENTION_COUNT, DEFAULT_BACKUP_FILE_FOLDER, DEFAULT_BACKUP_FILE_PATTERN } from '@tabmerger/shared'
import type { Group, Session } from '@/lib/types'
import {
  AUTO_BACKUP_SKIP_REASONS,
  MAX_PENDING_REMOTE_DELETES,
  backupGroups,
  backupIdentityHolds,
  claimBackupStore,
  describeBackupFile,
  isFreeAnswerFresh,
  deleteAutoBackup,
  describeAutoBackupOutcome,
  fingerprintGroups,
  flushPendingRemoteDeletes,
  getPendingRemoteDeletes,
  isAutoBackup,
  isBackupId,
  parseAutoBackupOutcome,
  parseAutoBackupState,
  parsePendingRemoteDeletes,
  readAutoBackupSettings,
  rearmSessionsFlagForBackup,
  runAutoBackup,
  selectAutoBackupsToPrune,
  withBackupLock,
} from '@/lib/autoBackup'
import {
  REARMED_BY_BACKUP,
  SESSIONS_HEAL_IN_PROGRESS,
  AUTO_BACKUP_FILE_LAST_KEY,
  AUTO_BACKUP_FILE_STATUS_KEY,
  AUTO_BACKUP_FREE_SEEN_KEY,
  AUTO_BACKUP_PENDING_DELETES_KEY,
  AUTO_BACKUP_STATE_KEY,
  AUTO_BACKUP_STORE_GUARD_KEY,
  LAST_USER_ID_KEY,
  SESSIONS_MIGRATION_DONE_KEY,
} from '@/lib/syncSettingKeys'

const h = vi.hoisted(() => {
  const log: string[] = []
  return {
    log,
    settings: new Map<string, unknown>(),
    sessions: [] as unknown[],
    groupsState: { available: [] as unknown[] },
    authSession: { user: { id: 'user-1' } } as unknown,
    tier: 'pro' as unknown,
    uploadResult: true as boolean | Error,
    remoteDeleteResult: true,
    /** runs inside fetchTier, i.e. at an await point of the run (the account switches, a wipe) */
    afterTier: null as null | (() => void),
    /** runs inside the file write (between the commit and the upload checks) */
    duringFile: null as null | (() => void),
    fileResult: { result: 'saved', path: 'TabMerger backups/x.json' } as { result: string; path: string },
    fileCalls: [] as unknown[][],
    freeSeenWrites: [] as unknown[],
    signedInCalls: 0,
    beforeCommit: null as null | (() => void),
    beforeSignedIn: null as null | ((n: number) => void),
    duringUpload: null as null | (() => void),
    commits: [] as unknown[],
    casCalls: [] as unknown[][],
    beforeCas: null as null | (() => void),
  }
})


interface Changes {
  putSessions?: { id: string }[]
  deleteSessionIds?: string[]
  settings?: Record<string, unknown>
  updateSettings?: Record<string, (stored: unknown) => unknown>
  markUploaded?: { ids: string[]; at: number }
}
/** One transaction's worth of changes; `updateSettings` functions see the value stored right now. */
function applyChanges(changes: Changes) {
  h.commits.push(changes)
  for (const s of changes.putSessions ?? []) {
    h.log.push(`saveSession:${s.id}`)
    h.sessions = [s, ...h.sessions.filter((x) => (x as { id: string }).id !== s.id)]
  }
  for (const id of changes.deleteSessionIds ?? []) {
    h.log.push(`deleteSession:${id}`)
    h.sessions = h.sessions.filter((x) => (x as { id: string }).id !== id)
  }
  for (const [k, v] of Object.entries(changes.settings ?? {})) {
    h.log.push(`setSetting:${k}`)
    h.settings.set(k, v)
    if (k === 'autoBackupFreeSeen') h.freeSeenWrites.push(v)
  }
  for (const [k, fn] of Object.entries(changes.updateSettings ?? {})) {
    h.log.push(`updateSetting:${k}`)
    h.settings.set(k, fn(h.settings.get(k)))
  }
  if (changes.markUploaded) {
    h.log.push(`markUploaded:${changes.markUploaded.ids.join(',')}`)
    h.sessions = h.sessions.map((x) => (changes.markUploaded!.ids.includes((x as { id: string }).id) ? { ...(x as object), uploadedAt: changes.markUploaded!.at } : x))
  }
}

vi.mock('@/lib/localDb', () => ({
  getGroupsState: vi.fn(async () => h.groupsState),
  getSessions: vi.fn(async () => [...h.sessions]),
  deleteSession: vi.fn(async (id: string) => {
    h.log.push(`deleteSession:${id}`)
    h.sessions = h.sessions.filter((x) => (x as { id: string }).id !== id)
  }),
  getSetting: vi.fn(async (k: string, d: unknown) => (h.settings.has(k) ? h.settings.get(k) : d)),
  setSetting: vi.fn(async (k: string, v: unknown) => {
    if (k !== 'autoBackupStoreGuard') h.log.push(`setSetting:${k}`)
    h.settings.set(k, v)
  }),
  // mirrors the real one: nothing at all is written unless the guard setting still equals the guard value
  commitSessionsIfGuardHolds: vi.fn(async (guard: { key: string; value: unknown }, changes: Changes) => {
    h.beforeCommit?.()
    if (!h.settings.has(guard.key) || h.settings.get(guard.key) !== guard.value) return false
    applyChanges(changes)
    return true
  }),
  // the unguarded form (deleting a backup on this device)
  commitSessions: vi.fn(async (changes: Changes) => void applyChanges(changes)),
  // one transaction in the real thing: strict equality on the stored value, written only on a match
  compareAndSetSetting: vi.fn(async (k: string, expected: unknown, next: unknown) => {
    h.casCalls.push([k, expected, next])
    h.beforeCas?.()
    if (!h.settings.has(k) || h.settings.get(k) !== expected) return false
    h.settings.set(k, next)
    return true
  }),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: h.authSession } })) } },
}))
vi.mock('@/lib/entitlementTier', () => ({
  fetchTier: vi.fn(async () => {
    h.log.push('fetchTier')
    h.afterTier?.()
    return h.tier
  }),
}))
vi.mock('@/lib/autoBackupFile', async (orig) => ({
  ...(await orig<typeof import('@/lib/autoBackupFile')>()),
  saveBackupFile: vi.fn(async (...a: unknown[]) => {
    h.log.push('file')
    h.fileCalls.push(a)
    h.duringFile?.()
    return h.fileResult
  }),
}))
vi.mock('@/lib/sessionUpload', () => ({
  isSignedInAs: vi.fn(async (id: string) => {
    h.beforeSignedIn?.(++h.signedInCalls)
    return (h.authSession as { user: { id: string } } | null)?.user.id === id
  }),
  pushSessionToSupabase: vi.fn(async (_s: unknown, uid: string) => {
    h.log.push(`upload:${uid}`)
    h.duringUpload?.()
    if (h.uploadResult instanceof Error) throw h.uploadResult
    return h.uploadResult
  }),
  deleteRemoteSessions: vi.fn(async (ids: string[], uid: string) => {
    h.log.push(`remoteDelete:${ids.join(',')}:${uid}`)
    return h.remoteDeleteResult
  }),
}))

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2030, 5, 15, 12, 0, 0)

const group = (id: string, extra: Partial<Group> = {}): Group => ({
  id,
  name: `Group ${id}`,
  color: 'rgba(1, 2, 3, 1)',
  updatedAt: 1,
  windows: [{ id: 1, incognito: false, focused: false, tabs: [{ id: 0, title: 't', url: 'https://example.com' }] }],
  ...extra,
})
const nowOpen = group('now', { permanent: true })
const session = (id: string, createdAt: number, auto = true): Session => ({ id, name: id, groups: [group('g')], createdAt, ...(auto ? { auto: true } : {}) })

beforeEach(() => {
  h.log.length = 0
  h.settings.clear()
  h.sessions = []
  h.groupsState = { available: [nowOpen, group('a'), group('b')] }
  h.authSession = { user: { id: 'user-1' } }
  h.tier = 'pro'
  h.uploadResult = true
  h.remoteDeleteResult = true
  h.afterTier = null
  h.duringFile = null
  h.fileResult = { result: 'saved', path: 'TabMerger backups/x.json' }
  h.fileCalls = []
  h.freeSeenWrites = []
  h.signedInCalls = 0
  h.beforeCommit = null
  h.beforeSignedIn = null
  h.commits = []
  h.casCalls = []
  h.beforeCas = null
  h.duringUpload = null
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('readAutoBackupSettings', () => {
  const DEFAULTS = { enabled: true, intervalMinutes: 1440, file: { enabled: false, folder: DEFAULT_BACKUP_FILE_FOLDER, pattern: DEFAULT_BACKUP_FILE_PATTERN } }
  it('defaults for null, non-objects and old stored objects without the keys', () => {
    for (const v of [null, undefined, 5, 'x', {}, { theme: 'dark' }]) {
      expect(readAutoBackupSettings(v)).toEqual(DEFAULTS)
    }
  })
  it('keeps valid values', () => {
    expect(
      readAutoBackupSettings({ autoBackupEnabled: false, autoBackupIntervalMinutes: 60, autoBackupFileEnabled: true, autoBackupFileFolder: 'My/Backups', autoBackupFilePattern: 'b {groups}' })
    ).toEqual({ enabled: false, intervalMinutes: 60, file: { enabled: true, folder: 'My/Backups', pattern: 'b {groups}' } })
  })
  it('replaces invalid stored values with defaults', () => {
    expect(readAutoBackupSettings({ autoBackupEnabled: 'no', autoBackupIntervalMinutes: 7 })).toEqual(DEFAULTS)
    expect(readAutoBackupSettings({ autoBackupIntervalMinutes: '60' }).intervalMinutes).toBe(1440)
  })
  it('only a real boolean turns the file copy on', () => {
    for (const v of ['true', 1, 'yes', {}, [], null]) expect(readAutoBackupSettings({ autoBackupFileEnabled: v }).file.enabled).toBe(false)
  })
  it.each([
    ['traversal', '../../etc'],
    ['absolute', '/etc'],
    ['drive letter', 'C:/Windows'],
    ['reserved name', 'CON'],
    ['control chars', 'a\u0000b'],
    ['too deep', 'a/b/c/d/e/f'],
    ['not a string', 5],
  ])('a stored folder that does not validate (%s) falls back to the default', (_n, folder) => {
    expect(readAutoBackupSettings({ autoBackupFileFolder: folder }).file.folder).toBe(DEFAULT_BACKUP_FILE_FOLDER)
  })
  it.each([
    ['path separator', 'a/b'],
    ['unknown token', 'x {secret}'],
    ['stray braces', 'x {'],
    ['empty', '   '],
    ['overlong', 'x'.repeat(101)],
    ['control chars', 'a\nb'],
    ['not a string', {}],
  ])('a stored pattern that does not validate (%s) falls back to the default', (_n, pattern) => {
    expect(readAutoBackupSettings({ autoBackupFilePattern: pattern }).file.pattern).toBe(DEFAULT_BACKUP_FILE_PATTERN)
  })
  it('an empty folder is valid and means directly in Downloads', () => {
    expect(readAutoBackupSettings({ autoBackupFileFolder: '' }).file.folder).toBe('')
  })
})

describe('isBackupId / parsePendingRemoteDeletes', () => {
  it('accepts nanoid-like ids and rejects everything else', () => {
    expect(isBackupId('abc_DEF-123')).toBe(true)
    expect(isBackupId('a'.repeat(64))).toBe(true)
    for (const v of ['', 'a'.repeat(65), 'a b', 'a/b', "x'; drop", 5, null, undefined, {}]) expect(isBackupId(v)).toBe(false)
  })
  it('keeps well-formed ids, dedupes and caps to the newest', () => {
    expect(parsePendingRemoteDeletes('x')).toEqual([])
    expect(parsePendingRemoteDeletes(null)).toEqual([])
    expect(parsePendingRemoteDeletes(['a', 'a', 'b c', 3, 'd'])).toEqual(['a', 'd'])
    const many = Array.from({ length: MAX_PENDING_REMOTE_DELETES + 20 }, (_, i) => `id${i}`)
    const out = parsePendingRemoteDeletes(many)
    expect(out).toHaveLength(MAX_PENDING_REMOTE_DELETES)
    expect(out[out.length - 1]).toBe(`id${MAX_PENDING_REMOTE_DELETES + 19}`)
  })
})

describe('parseAutoBackupState', () => {
  const ok = { lastBackupAt: 5, fingerprint: 'f', lastBackupId: 'id' }
  it('returns a valid state', () => expect(parseAutoBackupState(ok)).toEqual(ok))
  it('allows an empty fingerprint (seeded state)', () => {
    expect(parseAutoBackupState({ ...ok, fingerprint: '' })).toEqual({ ...ok, fingerprint: '' })
  })
  it.each([
    ['null', null],
    ['string', 'x'],
    ['no time', { ...ok, lastBackupAt: undefined }],
    ['zero time', { ...ok, lastBackupAt: 0 }],
    ['NaN time', { ...ok, lastBackupAt: NaN }],
    ['Infinity time', { ...ok, lastBackupAt: Infinity }],
    ['string time', { ...ok, lastBackupAt: '5' }],
    ['bad fingerprint', { ...ok, fingerprint: 3 }],
    ['bad id', { ...ok, lastBackupId: 3 }],
  ])('returns null for %s', (_n, v) => expect(parseAutoBackupState(v)).toBeNull())
})

describe('backupGroups / isAutoBackup / selectAutoBackupsToPrune', () => {
  it('excludes the permanent Now Open group', () => {
    expect(backupGroups([nowOpen, group('a')]).map((g) => g.id)).toEqual(['a'])
  })
  it('only the literal true marks an automatic backup', () => {
    expect(isAutoBackup({ auto: true })).toBe(true)
    expect(isAutoBackup({ auto: false })).toBe(false)
    expect(isAutoBackup({})).toBe(false)
    expect(isAutoBackup({ auto: 'true' as unknown as boolean })).toBe(false)
    expect(isAutoBackup({ auto: 1 as unknown as boolean })).toBe(false)
  })
  it('prunes automatic backups beyond the newest N, never manual sessions', () => {
    const autos = Array.from({ length: 13 }, (_, i) => session(`a${i}`, 1000 + i))
    const manual = [session('m-old', 1, false), session('m-new', 99999, false)]
    const prune = selectAutoBackupsToPrune([...manual, ...autos])
    expect(prune.map((s) => s.id).sort()).toEqual(['a0', 'a1', 'a2'])
    expect(prune.every(isAutoBackup)).toBe(true)
  })
  it('prunes nothing at or under the limit and handles keep edge values', () => {
    const autos = Array.from({ length: 10 }, (_, i) => session(`a${i}`, i + 1))
    expect(selectAutoBackupsToPrune(autos)).toEqual([])
    expect(selectAutoBackupsToPrune(autos, 3)).toHaveLength(7)
    expect(selectAutoBackupsToPrune(autos, 0)).toHaveLength(10)
    expect(selectAutoBackupsToPrune(autos, -4)).toHaveLength(10)
    expect(AUTO_BACKUP_RETENTION_COUNT).toBe(10)
  })
})

describe('fingerprintGroups', () => {
  it('is a 64-char hex SHA-256 and stable', async () => {
    const f = await fingerprintGroups([group('a')])
    expect(f).toMatch(/^[0-9a-f]{64}$/)
    expect(await fingerprintGroups([group('a')])).toBe(f)
  })
  it('ignores bookkeeping fields and key order', async () => {
    const base = group('a')
    const noisy: Group = { ...base, updatedAt: 999, pendingSync: true, positionDirty: true, remoteUpdatedAt: 'x', info: 'different' }
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as unknown as Group
    const f = await fingerprintGroups([base])
    expect(await fingerprintGroups([noisy])).toBe(f)
    expect(await fingerprintGroups([reordered])).toBe(f)
    expect(await fingerprintGroups([{ ...base, note: undefined }])).toBe(f)
  })
  it('changes when content or order changes', async () => {
    const a = group('a')
    const b = group('b')
    const f = await fingerprintGroups([a, b])
    expect(await fingerprintGroups([b, a])).not.toBe(f)
    expect(await fingerprintGroups([{ ...a, name: 'renamed' }, b])).not.toBe(f)
    expect(await fingerprintGroups([a])).not.toBe(f)
    const deeper = { ...a, windows: [{ ...a.windows[0], tabs: [{ id: 0, title: 't', url: 'https://example.com/other' }] }] }
    expect(await fingerprintGroups([deeper, b])).not.toBe(f)
  })
})

describe('withBackupLock', () => {
  it('uses navigator.locks when present: runs when granted, reports not-run when held', async () => {
    const request = vi.fn(async (_n: string, _o: unknown, cb: (l: unknown) => Promise<unknown>) => cb({}))
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    expect(await withBackupLock(async () => 7)).toEqual({ ran: true, value: 7 })
    expect(request).toHaveBeenCalledWith('tabmerger-auto-backup', { ifAvailable: true }, expect.any(Function))
    request.mockImplementationOnce(async (_n, _o, cb) => cb(null))
    const task = vi.fn()
    expect(await withBackupLock(task)).toEqual({ ran: false })
    expect(task).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('falls back to an in-process flag: a second concurrent call is refused, and it is released after', async () => {
    vi.stubGlobal('navigator', { ...navigator, locks: undefined })
    let release!: () => void
    const first = withBackupLock(() => new Promise<string>((r) => (release = () => r('done'))))
    expect(await withBackupLock(async () => 'second')).toEqual({ ran: false })
    release()
    expect(await first).toEqual({ ran: true, value: 'done' })
    expect(await withBackupLock(async () => 'third')).toEqual({ ran: true, value: 'third' })
    vi.unstubAllGlobals()
  })

  it('releases the fallback flag when the task throws', async () => {
    vi.stubGlobal('navigator', { ...navigator, locks: undefined })
    await expect(withBackupLock(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await withBackupLock(async () => 1)).toEqual({ ran: true, value: 1 })
    vi.unstubAllGlobals()
  })
})

describe('claimBackupStore / backupIdentityHolds', () => {
  it('claims the store for the signed-in user and returns that id', async () => {
    expect(await claimBackupStore()).toEqual({ userId: 'user-1' })
    expect(h.settings.get(AUTO_BACKUP_STORE_GUARD_KEY)).toBe('user-1')
  })
  it('signed out: blocked, nothing claimed', async () => {
    h.authSession = null
    expect(await claimBackupStore()).toEqual({ blocked: 'signed-out' })
    expect(h.settings.has(AUTO_BACKUP_STORE_GUARD_KEY)).toBe(false)
  })
  it('a store owned by another account: blocked, nothing claimed', async () => {
    h.settings.set(LAST_USER_ID_KEY, 'user-2')
    expect(await claimBackupStore()).toEqual({ blocked: 'account-mismatch' })
    expect(h.settings.has(AUTO_BACKUP_STORE_GUARD_KEY)).toBe(false)
  })
  it('holds only while signed in as that user, the owner is not someone else and the claim exists', async () => {
    await claimBackupStore()
    expect(await backupIdentityHolds('user-1')).toBe(true)
    // the signed-in account changed
    h.authSession = { user: { id: 'user-2' } }
    expect(await backupIdentityHolds('user-1')).toBe(false)
    h.authSession = null
    expect(await backupIdentityHolds('user-1')).toBe(false)
    h.authSession = { user: { id: 'user-1' } }
    // the store now records another owner
    h.settings.set(LAST_USER_ID_KEY, 'user-2')
    expect(await backupIdentityHolds('user-1')).toBe(false)
    h.settings.set(LAST_USER_ID_KEY, 'user-1')
    expect(await backupIdentityHolds('user-1')).toBe(true)
    // a wipe removed the claim, or it names someone else
    h.settings.delete(AUTO_BACKUP_STORE_GUARD_KEY)
    expect(await backupIdentityHolds('user-1')).toBe(false)
    h.settings.set(AUTO_BACKUP_STORE_GUARD_KEY, 'user-2')
    expect(await backupIdentityHolds('user-1')).toBe(false)
  })
})

describe('pending remote deletes', () => {
  beforeEach(() => void h.settings.set(AUTO_BACKUP_STORE_GUARD_KEY, 'user-1'))

  it('flush is a no-op with nothing pending (no request)', async () => {
    expect(await flushPendingRemoteDeletes('user-1')).toEqual([])
    expect(h.log.some((l) => l.startsWith('remoteDelete'))).toBe(false)
  })

  it('writes the list BEFORE the request and clears it on success, and the request carries the user id', async () => {
    expect(await flushPendingRemoteDeletes('user-1', ['x1'])).toEqual([])
    expect(h.log).toEqual([`updateSetting:${AUTO_BACKUP_PENDING_DELETES_KEY}`, 'remoteDelete:x1:user-1', `updateSetting:${AUTO_BACKUP_PENDING_DELETES_KEY}`])
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual([])
  })

  it('keeps the list when the request is not confirmed, and retries it with the next flush', async () => {
    h.remoteDeleteResult = false
    expect(await flushPendingRemoteDeletes('user-1', ['x1'])).toEqual(['x1'])
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual(['x1'])
    h.remoteDeleteResult = true
    expect(await flushPendingRemoteDeletes('user-1', ['x2'])).toEqual([])
    expect(h.log).toContain('remoteDelete:x1,x2:user-1')
    expect(await getPendingRemoteDeletes()).toEqual([])
  })

  it('the store is not claimed for that user (a wipe, another account): nothing is written and nothing is sent', async () => {
    h.settings.set(AUTO_BACKUP_STORE_GUARD_KEY, 'user-2')
    expect(await flushPendingRemoteDeletes('user-1', ['x1'])).toEqual(['x1'])
    expect(h.log).toEqual([])
    expect(h.settings.has(AUTO_BACKUP_PENDING_DELETES_KEY)).toBe(false)
  })

  it('drops malformed ids from both the stored list and the extra ids', async () => {
    h.settings.set(AUTO_BACKUP_PENDING_DELETES_KEY, ['ok', 'not ok', 4])
    expect(await getPendingRemoteDeletes()).toEqual(['ok'])
    await flushPendingRemoteDeletes('user-1', ['../x', 'fine'])
    expect(h.log).toContain('remoteDelete:ok,fine:user-1')
  })

  it('deleteAutoBackup deletes locally, then flushes the id remotely for the signed-in user', async () => {
    h.sessions = [session('b1', 1)]
    await deleteAutoBackup('b1')
    expect(h.sessions).toEqual([])
    expect(h.log[0]).toBe('deleteSession:b1')
    expect(h.log).toContain('remoteDelete:b1:user-1')
  })

  it('deleteAutoBackup keeps the id pending when the server did not confirm', async () => {
    h.remoteDeleteResult = false
    await deleteAutoBackup('b1')
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual(['b1'])
  })

  it('deleteAutoBackup signed out: deletes locally, sends nothing, remembers the id', async () => {
    h.authSession = null
    await deleteAutoBackup('b1')
    expect(h.log.some((l) => l.startsWith('remoteDelete'))).toBe(false)
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual(['b1'])
  })

  it("deleteAutoBackup on another account's store: sends nothing, remembers the id", async () => {
    h.settings.set(LAST_USER_ID_KEY, 'user-2')
    await deleteAutoBackup('b1')
    expect(h.log.some((l) => l.startsWith('remoteDelete'))).toBe(false)
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual(['b1'])
  })

  it('deleteAutoBackup does not send a malformed id to the server', async () => {
    await deleteAutoBackup('bad id')
    expect(h.log).toEqual(['deleteSession:bad id'])
  })
})

describe('isFreeAnswerFresh', () => {
  const at = NOW - 1000
  it('fresh for the same user within the window', () => {
    expect(isFreeAnswerFresh({ userId: 'user-1', at }, 'user-1', NOW)).toBe(true)
    expect(isFreeAnswerFresh({ userId: 'user-1', at: NOW - AUTO_BACKUP_FREE_RECHECK_MS + 1 }, 'user-1', NOW)).toBe(true)
  })
  it('expires exactly at the window length', () => {
    expect(isFreeAnswerFresh({ userId: 'user-1', at: NOW - AUTO_BACKUP_FREE_RECHECK_MS }, 'user-1', NOW)).toBe(false)
  })
  it('is for one account only', () => {
    expect(isFreeAnswerFresh({ userId: 'user-2', at }, 'user-1', NOW)).toBe(false)
  })
  it('a stamp in the future (clock moved back) is not trusted', () => {
    expect(isFreeAnswerFresh({ userId: 'user-1', at: NOW + 1 }, 'user-1', NOW)).toBe(false)
  })
  it.each([null, undefined, 5, 'x', {}, { userId: 'user-1' }, { userId: 'user-1', at: '5' }, { userId: 'user-1', at: NaN }, { userId: 'user-1', at: Infinity }])('rejects %j', (v) => {
    expect(isFreeAnswerFresh(v, 'user-1', NOW)).toBe(false)
  })
})

describe('runAutoBackup skip reasons', () => {
  it('disabled: skips, but a manual run ignores the switch', async () => {
    h.settings.set('appSettings', { autoBackupEnabled: false })
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'disabled' })
    expect((await runAutoBackup({ now: NOW, manual: true })).status).toBe('created')
  })

  it('signed-out', async () => {
    h.authSession = null
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'signed-out' })
    expect(h.log).toEqual([])
  })

  it('account-mismatch: the local store belongs to another account', async () => {
    h.settings.set(LAST_USER_ID_KEY, 'user-2')
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'account-mismatch' })
    expect(await runAutoBackup({ now: NOW, manual: true })).toEqual({ status: 'skipped', reason: 'account-mismatch' })
    expect(h.log).toEqual([])
  })

  it('runs when the local store is owned by the same account or has no owner', async () => {
    h.settings.set(LAST_USER_ID_KEY, 'user-1')
    expect((await runAutoBackup({ now: NOW })).status).toBe('created')
  })

  it('not-due: skips within the interval, manual ignores it, a future stamp counts as due', async () => {
    h.settings.set(AUTO_BACKUP_STATE_KEY, { lastBackupAt: NOW - 1000, fingerprint: 'other', lastBackupId: 'x' })
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'not-due' })
    expect((await runAutoBackup({ now: NOW, manual: true })).status).toBe('created')

    h.settings.set(AUTO_BACKUP_STATE_KEY, { lastBackupAt: NOW + DAY, fingerprint: 'other', lastBackupId: 'x' })
    expect((await runAutoBackup({ now: NOW })).status).toBe('created')
  })

  it('not-due respects the configured interval', async () => {
    h.settings.set('appSettings', { autoBackupIntervalMinutes: 10080 })
    h.settings.set(AUTO_BACKUP_STATE_KEY, { lastBackupAt: NOW - 2 * DAY, fingerprint: 'other', lastBackupId: 'x' })
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'not-due' })
    h.settings.set('appSettings', { autoBackupIntervalMinutes: 60 })
    expect((await runAutoBackup({ now: NOW })).status).toBe('created')
  })

  it('empty: no saved groups (only Now Open) skips even when manual, and writes nothing', async () => {
    h.groupsState = { available: [nowOpen] }
    h.sessions = [session('keep', 5)]
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'empty' })
    expect(await runAutoBackup({ now: NOW, manual: true })).toEqual({ status: 'skipped', reason: 'empty' })
    expect(h.sessions.map((s) => (s as Session).id)).toEqual(['keep'])
    // the only writes are the pending-delete bookkeeping of the flush that follows the claim
    expect(h.log.filter((l) => l !== `updateSetting:${AUTO_BACKUP_PENDING_DELETES_KEY}`)).toEqual([])
  })

  it('unchanged: same fingerprint and the last backup still exists, also for a manual run', async () => {
    const fp = await fingerprintGroups([group('a'), group('b')])
    h.sessions = [session('last', NOW - 5 * DAY)]
    h.settings.set(AUTO_BACKUP_STATE_KEY, { lastBackupAt: NOW - 5 * DAY, fingerprint: fp, lastBackupId: 'last' })
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'unchanged' })
    expect(await runAutoBackup({ now: NOW, manual: true })).toEqual({ status: 'skipped', reason: 'unchanged' })
    expect(h.log).not.toContain('fetchTier')
  })

  it('same fingerprint but the last backup was deleted: takes a new one', async () => {
    const fp = await fingerprintGroups([group('a'), group('b')])
    h.settings.set(AUTO_BACKUP_STATE_KEY, { lastBackupAt: NOW - 5 * DAY, fingerprint: fp, lastBackupId: 'gone' })
    expect((await runAutoBackup({ now: NOW })).status).toBe('created')
  })

  it('same fingerprint but the stored id now belongs to a manual session: takes a new one', async () => {
    const fp = await fingerprintGroups([group('a'), group('b')])
    h.sessions = [session('last', NOW - 5 * DAY, false)]
    h.settings.set(AUTO_BACKUP_STATE_KEY, { lastBackupAt: NOW - 5 * DAY, fingerprint: fp, lastBackupId: 'last' })
    expect((await runAutoBackup({ now: NOW })).status).toBe('created')
  })

  it('tier-unknown: a failed subscription check never creates or uploads anything', async () => {
    h.tier = null
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'tier-unknown' })
    expect(await runAutoBackup({ now: NOW, manual: true })).toEqual({ status: 'skipped', reason: 'tier-unknown' })
    expect(h.sessions).toEqual([])
    expect(h.log.some((l) => l.startsWith('upload'))).toBe(false)
    expect(h.log.some((l) => l.startsWith('saveSession'))).toBe(false)
  })

  it('not-entitled: a free account never reaches saveSession, an upload, or the state write', async () => {
    h.tier = 'free'
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'not-entitled' })
    expect(await runAutoBackup({ now: NOW, manual: true })).toEqual({ status: 'skipped', reason: 'not-entitled' })
    expect(h.sessions).toEqual([])
    // the only thing written is the remembered "not paid" answer
    expect(h.log.filter((l) => l !== 'fetchTier' && l !== `updateSetting:${AUTO_BACKUP_PENDING_DELETES_KEY}`)).toEqual([`setSetting:${AUTO_BACKUP_FREE_SEEN_KEY}`, `setSetting:${AUTO_BACKUP_FREE_SEEN_KEY}`])
    expect(h.settings.has(AUTO_BACKUP_STATE_KEY)).toBe(false)
  })

  it.each(['pro', 'pro_ai'])('entitled tier %s runs', async (tier) => {
    h.tier = tier
    expect((await runAutoBackup({ now: NOW })).status).toBe('created')
  })

  it('busy when the lock is held', async () => {
    const request = vi.fn(async (_n: string, _o: unknown, cb: (l: unknown) => Promise<unknown>) => cb(null))
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'busy' })
    vi.unstubAllGlobals()
  })

  it('returns an error outcome instead of throwing', async () => {
    const { getGroupsState } = await import('@/lib/localDb')
    vi.mocked(getGroupsState).mockRejectedValueOnce(new Error('idb down'))
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'error', message: 'idb down' })
    vi.mocked(getGroupsState).mockRejectedValueOnce('plain')
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'error', message: 'plain' })
  })
})

describe('runAutoBackup created', () => {
  it('saves an auto session of the saved groups only (never Now Open), named and stamped', async () => {
    const out = await runAutoBackup({ now: NOW })
    expect(out).toMatchObject({ status: 'created', createdAt: NOW, uploaded: true, pruned: 0 })
    const saved = h.sessions[0] as Session
    expect(saved.auto).toBe(true)
    expect(saved.groups.map((g) => g.id)).toEqual(['a', 'b'])
    expect(saved.createdAt).toBe(NOW)
    expect(saved.name.startsWith('Automatic backup · ')).toBe(true)
    expect(out.status === 'created' && out.sessionId).toBe(saved.id)
  })

  it('stores time, fingerprint and id', async () => {
    const out = await runAutoBackup({ now: NOW })
    const id = out.status === 'created' ? out.sessionId : ''
    expect(h.settings.get(AUTO_BACKUP_STATE_KEY)).toEqual({
      lastBackupAt: NOW,
      fingerprint: await fingerprintGroups([group('a'), group('b')]),
      lastBackupId: id,
    })
  })

  it('writes the state BEFORE any network call (upload and remote delete)', async () => {
    h.sessions = Array.from({ length: 10 }, (_, i) => session(`old${i}`, i + 1))
    await runAutoBackup({ now: NOW })
    const state = h.log.indexOf(`setSetting:${AUTO_BACKUP_STATE_KEY}`)
    expect(state).toBeGreaterThan(-1)
    expect(state).toBeLessThan(h.log.findIndex((l) => l.startsWith('remoteDelete')))
    expect(state).toBeLessThan(h.log.indexOf('upload:user-1'))
    // the tier check is the last read before anything is written
    expect(h.log.indexOf('fetchTier')).toBeLessThan(h.log.findIndex((l) => l.startsWith('saveSession')))
  })

  it('rotation keeps the newest 10 automatic, never removes manual sessions, and deletes the old ones remotely', async () => {
    const autos = Array.from({ length: 10 }, (_, i) => session(`old${i}`, 1000 + i))
    const manual = [session('m1', 1, false), session('m2', 2, false)]
    h.sessions = [...manual, ...autos]
    const out = await runAutoBackup({ now: NOW })
    expect(out).toMatchObject({ status: 'created', pruned: 1 })
    const ids = (h.sessions as Session[]).map((s) => s.id)
    expect(ids).not.toContain('old0')
    expect(ids).toEqual(expect.arrayContaining(['m1', 'm2', 'old9']))
    expect((h.sessions as Session[]).filter(isAutoBackup)).toHaveLength(10)
    expect(h.log).toContain('remoteDelete:old0:user-1')
  })

  it('a rotation delete the server did not confirm stays pending', async () => {
    h.sessions = Array.from({ length: 10 }, (_, i) => session(`old${i}`, 1000 + i))
    h.remoteDeleteResult = false
    await runAutoBackup({ now: NOW })
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual(['old0'])
  })

  it('an upload that does not happen keeps the backup local and re-arms the self-heal', async () => {
    h.uploadResult = false
    const out = await runAutoBackup({ now: NOW })
    expect(out).toMatchObject({ status: 'created', uploaded: false })
    expect(h.sessions).toHaveLength(1)
    expect(h.settings.get(SESSIONS_MIGRATION_DONE_KEY)).toBe(false)
  })

  it('an upload that throws is the same as one that did not happen', async () => {
    h.uploadResult = new Error('network')
    const out = await runAutoBackup({ now: NOW })
    expect(out).toMatchObject({ status: 'created', uploaded: false })
    expect(h.settings.get(SESSIONS_MIGRATION_DONE_KEY)).toBe(false)
    expect(h.settings.get(AUTO_BACKUP_STATE_KEY)).toBeTruthy()
  })

  it('a second run right after is unchanged (and not due)', async () => {
    await runAutoBackup({ now: NOW })
    expect(await runAutoBackup({ now: NOW + 1000 })).toEqual({ status: 'skipped', reason: 'not-due' })
    expect(await runAutoBackup({ now: NOW + 1000, manual: true })).toEqual({ status: 'skipped', reason: 'unchanged' })
  })

  it('does not run a groups sync cycle: only the documented modules are touched', async () => {
    await runAutoBackup({ now: NOW })
    expect(h.log.some((l) => /sync/i.test(l))).toBe(false)
  })
})

describe('parseAutoBackupOutcome / describeAutoBackupOutcome', () => {
  it('parses a created outcome with defaults for loose fields', () => {
    expect(parseAutoBackupOutcome({ status: 'created', sessionId: 's', createdAt: 5, uploaded: true, pruned: 2 })).toEqual({
      status: 'created', sessionId: 's', createdAt: 5, uploaded: true, pruned: 2,
    })
    expect(parseAutoBackupOutcome({ status: 'created', sessionId: 's', createdAt: 5, uploaded: 'yes', pruned: 'x' })).toEqual({
      status: 'created', sessionId: 's', createdAt: 5, uploaded: false, pruned: 0,
    })
  })
  it('parses skipped for known reasons only', () => {
    expect(parseAutoBackupOutcome({ status: 'skipped', reason: 'unchanged' })).toEqual({ status: 'skipped', reason: 'unchanged' })
    expect(parseAutoBackupOutcome({ status: 'skipped', reason: 'made-up' })).toBeNull()
  })
  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'])('rejects the prototype key %s as a skip reason', (reason) => {
    expect(parseAutoBackupOutcome({ status: 'skipped', reason })).toBeNull()
  })
  it('every listed skip reason parses and has a message', () => {
    for (const reason of AUTO_BACKUP_SKIP_REASONS) {
      expect(parseAutoBackupOutcome({ status: 'skipped', reason })).toEqual({ status: 'skipped', reason })
      expect(describeAutoBackupOutcome({ status: 'skipped', reason }).message.length).toBeGreaterThan(5)
    }
    expect(AUTO_BACKUP_SKIP_REASONS).toContain('identity-changed')
  })
  it('a created outcome keeps a valid file result and a bounded path, and ignores an invalid one', () => {
    const base = { status: 'created', sessionId: 's', createdAt: 5, uploaded: true, pruned: 0 }
    expect(parseAutoBackupOutcome({ ...base, file: 'saved', filePath: 'A/b.json' })).toMatchObject({ file: 'saved', filePath: 'A/b.json' })
    expect(parseAutoBackupOutcome({ ...base, file: 'saved', filePath: 'x'.repeat(500) })).toMatchObject({ filePath: 'x'.repeat(300) })
    expect(parseAutoBackupOutcome({ ...base, file: 'saved', filePath: 7 })).toMatchObject({ file: 'saved', filePath: '' })
    for (const file of ['toString', 'ok', 5, null]) expect(parseAutoBackupOutcome({ ...base, file })).not.toHaveProperty('file')
  })
  it('parses error with an empty message fallback', () => {
    expect(parseAutoBackupOutcome({ status: 'error', message: 'm' })).toEqual({ status: 'error', message: 'm' })
    expect(parseAutoBackupOutcome({ status: 'error' })).toEqual({ status: 'error', message: '' })
  })
  it.each([null, undefined, 3, 'x', {}, { status: 'created' }, { status: 'created', sessionId: 1, createdAt: 1 }])('returns null for %j', (v) => {
    expect(parseAutoBackupOutcome(v)).toBeNull()
  })

  it('describes every outcome', () => {
    expect(describeAutoBackupOutcome(null)).toEqual({ ok: false, message: 'The backup could not be created. Try again.' })
    expect(describeAutoBackupOutcome({ status: 'error', message: 'x' }).ok).toBe(false)
    expect(describeAutoBackupOutcome({ status: 'created', sessionId: 's', createdAt: 1, uploaded: true, pruned: 0 })).toEqual({ ok: true, message: 'Backup saved.' })
    expect(describeAutoBackupOutcome({ status: 'created', sessionId: 's', createdAt: 1, uploaded: false, pruned: 0 }).message).toMatch(/on this device/)
    for (const reason of AUTO_BACKUP_SKIP_REASONS) {
      const d = describeAutoBackupOutcome({ status: 'skipped', reason })
      expect(d.ok).toBe(false)
      expect(d.message.length).toBeGreaterThan(5)
    }
    expect(describeAutoBackupOutcome({ status: 'skipped', reason: 'unchanged' }).message).toBe('Nothing has changed since the last backup.')
  })

  it('describes the file copy', () => {
    expect(describeBackupFile('saved', 'A/b.json')).toBe('File saved to Downloads/A/b.json')
    expect(describeBackupFile('no-permission', 'x')).toMatch(/no longer has permission/)
    expect(describeBackupFile('failed', 'x')).toMatch(/could not be saved/)
    const created = { status: 'created', sessionId: 's', createdAt: 1, uploaded: true, pruned: 0, file: 'saved', filePath: 'A/b.json' } as const
    expect(describeAutoBackupOutcome(created)).toEqual({ ok: true, message: 'Backup saved. File saved to Downloads/A/b.json' })
    // a failed file never turns a successful backup into a failure toast
    expect(describeAutoBackupOutcome({ ...created, file: 'failed' }).ok).toBe(true)
    expect(describeAutoBackupOutcome({ ...created, uploaded: false, file: 'no-permission' }).message).toMatch(/on this device.*no longer has permission/)
  })
})

describe('runAutoBackup: identity at each await point', () => {
  const nothingWrittenFor = () => {
    expect(h.sessions).toEqual([])
    expect(h.settings.has(AUTO_BACKUP_STATE_KEY)).toBe(false)
    // the flush after the claim may store an EMPTY list; nothing is pending for this run
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY) ?? []).toEqual([])
    expect(h.log.some((l) => l.startsWith('upload') || l.startsWith('remoteDelete') || l.startsWith('saveSession'))).toBe(false)
  }

  it('the account changes while the plan is being checked: stops before writing anything', async () => {
    h.afterTier = () => void (h.authSession = { user: { id: 'user-2' } })
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'identity-changed' })
    nothingWrittenFor()
  })

  it('the user signs out while the plan is being checked', async () => {
    h.afterTier = () => void (h.authSession = null)
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'identity-changed' })
    nothingWrittenFor()
  })

  it('the store is wiped while the plan is being checked (the claim is gone)', async () => {
    h.afterTier = () => void h.settings.delete(AUTO_BACKUP_STORE_GUARD_KEY)
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'identity-changed' })
    nothingWrittenFor()
  })

  it('the store records another owner while the plan is being checked', async () => {
    h.afterTier = () => void h.settings.set(LAST_USER_ID_KEY, 'user-2')
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'identity-changed' })
    nothingWrittenFor()
  })

  it('a wipe lands between the identity check and the commit: the conditional commit writes nothing at all', async () => {
    // the identity check passed; the wipe lands before the transaction runs
    h.beforeCommit = () => {
      h.settings.delete(AUTO_BACKUP_STORE_GUARD_KEY)
      h.beforeCommit = null
    }
    h.sessions = Array.from({ length: 10 }, (_, i) => session(`old${i}`, i + 1))
    const before = [...h.sessions]
    const out = await runAutoBackup({ now: NOW })
    expect(out).toEqual({ status: 'skipped', reason: 'identity-changed' })
    expect(h.sessions).toEqual(before)
    expect(h.settings.has(AUTO_BACKUP_STATE_KEY)).toBe(false)
    expect(h.log.some((l) => l.startsWith('upload') || l.startsWith('remoteDelete'))).toBe(false)
  })

  it('the account changes after the local write: the backup stays, nothing is uploaded or deleted remotely, the self-heal is re-armed', async () => {
    h.sessions = Array.from({ length: 10 }, (_, i) => session(`old${i}`, i + 1))
    h.beforeSignedIn = (n) => {
      if (n === 2) h.authSession = { user: { id: 'user-2' } }
    }
    // the store is still claimed by user-1, so the re-arm lands (it is conditional on that claim)
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'identity-changed' })
    expect(h.sessions).toHaveLength(10) // new one in, oldest rotated out locally
    expect(h.settings.get(AUTO_BACKUP_STATE_KEY)).toBeTruthy()
    // the rotated-out id stays remembered for the owner's next run; nothing was sent for it
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual(['old0'])
    expect(h.log.some((l) => l.startsWith('upload') || l.startsWith('remoteDelete'))).toBe(false)
    expect(h.settings.get(SESSIONS_MIGRATION_DONE_KEY)).toBe(false)
  })

  it('a wipe after the local write: the re-arm is conditional too, so it cannot land in the wiped store', async () => {
    h.beforeSignedIn = (n) => {
      if (n === 2) {
        h.authSession = { user: { id: 'user-2' } }
        h.settings.delete(AUTO_BACKUP_STORE_GUARD_KEY)
      }
    }
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'identity-changed' })
    // only the main commit (before the wipe) touched the flag, through updateSettings: the second,
    // conditional plain re-arm did not land
    expect(h.log.filter((l) => l === `setSetting:${SESSIONS_MIGRATION_DONE_KEY}`)).toHaveLength(0)
    expect(h.log.filter((l) => l === `updateSetting:${SESSIONS_MIGRATION_DONE_KEY}`)).toHaveLength(1)
  })

  it('a wipe during the upload: the uploaded marker is conditional and is not written into the wiped store', async () => {
    h.duringUpload = () => void h.settings.delete(AUTO_BACKUP_STORE_GUARD_KEY)
    const out = await runAutoBackup({ now: NOW })
    expect(out).toMatchObject({ status: 'created', uploaded: true })
    expect(h.log.some((l) => l.startsWith('markUploaded'))).toBe(false)
    expect((h.sessions[0] as Session).uploadedAt).toBeUndefined()
  })

  it('an upload that succeeds stamps uploadedAt, so the self-heal never inserts it again', async () => {
    await runAutoBackup({ now: NOW })
    expect((h.sessions[0] as Session).uploadedAt).toBe(NOW)
  })

  it('an upload that does not happen leaves no uploadedAt', async () => {
    h.uploadResult = false
    await runAutoBackup({ now: NOW })
    expect((h.sessions[0] as Session).uploadedAt).toBeUndefined()
  })

  it('every request carries the user id the run started for', async () => {
    h.sessions = Array.from({ length: 10 }, (_, i) => session(`old${i}`, i + 1))
    await runAutoBackup({ now: NOW })
    const requests = h.log.filter((l) => l.startsWith('upload') || l.startsWith('remoteDelete'))
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((l) => l.endsWith(':user-1'))).toBe(true)
  })

  it('the store is claimed for the user the run started for', async () => {
    await runAutoBackup({ now: NOW })
    expect(h.settings.get(AUTO_BACKUP_STORE_GUARD_KEY)).toBe('user-1')
  })
})

describe('runAutoBackup: remembered "not paid" answer', () => {
  const fetchTierCalls = () => h.log.filter((l) => l === 'fetchTier').length

  it('a free answer is remembered per account with the time', async () => {
    h.tier = 'free'
    await runAutoBackup({ now: NOW })
    expect(h.freeSeenWrites).toEqual([{ userId: 'user-1', at: NOW }])
  })

  it('a scheduled run inside the window stops before any request', async () => {
    h.tier = 'free'
    await runAutoBackup({ now: NOW })
    expect(await runAutoBackup({ now: NOW + 1000 })).toEqual({ status: 'skipped', reason: 'not-entitled' })
    expect(await runAutoBackup({ now: NOW + AUTO_BACKUP_FREE_RECHECK_MS - 1 })).toEqual({ status: 'skipped', reason: 'not-entitled' })
    expect(fetchTierCalls()).toBe(1)
  })

  it('the memo expires: at the window length the plan is asked again', async () => {
    h.tier = 'free'
    await runAutoBackup({ now: NOW })
    await runAutoBackup({ now: NOW + AUTO_BACKUP_FREE_RECHECK_MS })
    expect(fetchTierCalls()).toBe(2)
  })

  it('an upgraded account is picked up once the memo expires, and the paid answer clears the memo', async () => {
    h.tier = 'free'
    await runAutoBackup({ now: NOW })
    h.tier = 'pro'
    expect((await runAutoBackup({ now: NOW + AUTO_BACKUP_FREE_RECHECK_MS })).status).toBe('created')
    expect(h.settings.get(AUTO_BACKUP_FREE_SEEN_KEY)).toBeNull()
  })

  it('recheckTier asks again inside the window (saving a setting)', async () => {
    h.tier = 'free'
    await runAutoBackup({ now: NOW })
    h.tier = 'pro'
    expect((await runAutoBackup({ now: NOW + 1000, recheckTier: true })).status).toBe('created')
    expect(fetchTierCalls()).toBe(2)
  })

  it('a manual run (Back up now) always asks again', async () => {
    h.tier = 'free'
    await runAutoBackup({ now: NOW })
    h.tier = 'pro'
    expect((await runAutoBackup({ now: NOW + 1000, manual: true })).status).toBe('created')
  })

  it('the memo of another account is ignored', async () => {
    h.settings.set(AUTO_BACKUP_FREE_SEEN_KEY, { userId: 'user-2', at: NOW - 1000 })
    expect((await runAutoBackup({ now: NOW })).status).toBe('created')
  })

  it('a memo from the future or a malformed one is ignored', async () => {
    for (const memo of [{ userId: 'user-1', at: NOW + 5000 }, 'free', { userId: 'user-1' }]) {
      h.settings.set(AUTO_BACKUP_FREE_SEEN_KEY, memo)
      h.sessions = []
      h.settings.delete(AUTO_BACKUP_STATE_KEY)
      expect((await runAutoBackup({ now: NOW })).status).toBe('created')
    }
  })

  it('the not-paid memo is not written when the store was wiped while the plan was checked', async () => {
    h.tier = 'free'
    h.afterTier = () => void h.settings.delete(AUTO_BACKUP_STORE_GUARD_KEY)
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'not-entitled' })
    expect(h.freeSeenWrites).toEqual([])
  })

  it('"not due" is decided before the memo or any request', async () => {
    h.tier = 'free'
    h.settings.set(AUTO_BACKUP_STATE_KEY, { lastBackupAt: NOW - 1000, fingerprint: 'x', lastBackupId: 'x' })
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'not-due' })
    expect(fetchTierCalls()).toBe(0)
  })
})

describe('runAutoBackup: file copy', () => {
  const enableFile = (extra: Record<string, unknown> = {}) => h.settings.set('appSettings', { autoBackupFileEnabled: true, ...extra })

  it('off by default: no file is written and the outcome has no file fields', async () => {
    const out = await runAutoBackup({ now: NOW })
    expect(h.fileCalls).toHaveLength(0)
    expect(out).not.toHaveProperty('file')
    expect(h.settings.has(AUTO_BACKUP_FILE_STATUS_KEY)).toBe(false)
  })

  it('on: writes the file for the new backup with the stored folder and pattern, records the status and reports it', async () => {
    enableFile({ autoBackupFileFolder: 'Mine/Sub', autoBackupFilePattern: 'b {groups}' })
    const out = await runAutoBackup({ now: NOW })
    expect(out).toMatchObject({ status: 'created', file: 'saved', filePath: 'TabMerger backups/x.json' })
    expect(h.fileCalls).toHaveLength(1)
    const [sess, folder, pattern] = h.fileCalls[0] as [Session, string, string]
    expect(sess.id).toBe((h.sessions[0] as Session).id)
    expect(sess.groups.map((g) => g.id)).toEqual(['a', 'b']) // never Now Open
    expect([folder, pattern]).toEqual(['Mine/Sub', 'b {groups}'])
    expect(h.settings.get(AUTO_BACKUP_FILE_STATUS_KEY)).toEqual({ at: NOW, result: 'saved', path: 'TabMerger backups/x.json' })
  })

  it('hostile stored folder and pattern never reach the file writer as written: they are replaced by the defaults first', async () => {
    enableFile({ autoBackupFileFolder: '../../Windows/System32', autoBackupFilePattern: '..\\evil {secret}' })
    await runAutoBackup({ now: NOW })
    const [, folder, pattern] = h.fileCalls[0] as [Session, string, string]
    expect(folder).toBe(DEFAULT_BACKUP_FILE_FOLDER)
    expect(pattern).toBe(DEFAULT_BACKUP_FILE_PATTERN)
  })

  it.each(['failed', 'no-permission'])('a %s file never fails the backup and is reported', async (result) => {
    enableFile()
    h.fileResult = { result, path: 'p.json' }
    const out = await runAutoBackup({ now: NOW })
    expect(out).toMatchObject({ status: 'created', uploaded: true, file: result })
    expect(h.sessions).toHaveLength(1)
    expect(h.settings.get(AUTO_BACKUP_FILE_STATUS_KEY)).toMatchObject({ result })
  })

  it('does not depend on the upload: an offline backup still gets its file', async () => {
    enableFile()
    h.uploadResult = false
    expect(await runAutoBackup({ now: NOW })).toMatchObject({ status: 'created', uploaded: false, file: 'saved' })
  })

  describe('the last file (autoBackupFileLast)', () => {
    const withId = (result: string, downloadId?: number) =>
      (h.fileResult = { result, path: 'p.json', ...(downloadId === undefined ? {} : { downloadId }) } as typeof h.fileResult)

    it('a saved file stores { id, at } next to the status', async () => {
      enableFile()
      withId('saved', 42)
      await runAutoBackup({ now: NOW })
      expect(h.settings.get(AUTO_BACKUP_FILE_LAST_KEY)).toEqual({ id: 42, at: NOW })
      expect(h.settings.get(AUTO_BACKUP_FILE_STATUS_KEY)).toMatchObject({ at: NOW, result: 'saved' })
    })

    it('download id 0 is stored (it is a real id)', async () => {
      enableFile()
      withId('saved', 0)
      await runAutoBackup({ now: NOW })
      expect(h.settings.get(AUTO_BACKUP_FILE_LAST_KEY)).toEqual({ id: 0, at: NOW })
    })

    it('is not written when the file option is off', async () => {
      withId('saved', 42)
      await runAutoBackup({ now: NOW })
      expect(h.settings.has(AUTO_BACKUP_FILE_LAST_KEY)).toBe(false)
    })

    it('is not written when no id came back, even if the result says saved', async () => {
      enableFile()
      withId('saved')
      await runAutoBackup({ now: NOW })
      expect(h.settings.has(AUTO_BACKUP_FILE_LAST_KEY)).toBe(false)
    })

    it.each(['failed', 'no-permission'])('a %s write keeps the previous value and still records the status', async (result) => {
      enableFile()
      h.settings.set(AUTO_BACKUP_FILE_LAST_KEY, { id: 5, at: NOW - 1000 })
      withId(result, 99)
      await runAutoBackup({ now: NOW })
      expect(h.settings.get(AUTO_BACKUP_FILE_LAST_KEY)).toEqual({ id: 5, at: NOW - 1000 })
      expect(h.settings.get(AUTO_BACKUP_FILE_STATUS_KEY)).toMatchObject({ result })
    })

    it('a later saved file replaces the previous value', async () => {
      enableFile()
      h.settings.set(AUTO_BACKUP_FILE_LAST_KEY, { id: 5, at: NOW - 1000 })
      withId('saved', 6)
      await runAutoBackup({ now: NOW })
      expect(h.settings.get(AUTO_BACKUP_FILE_LAST_KEY)).toEqual({ id: 6, at: NOW })
    })

    it('a wipe during the file write stores neither the status nor the id', async () => {
      enableFile()
      withId('saved', 42)
      h.duringFile = () => void h.settings.delete(AUTO_BACKUP_STORE_GUARD_KEY)
      await runAutoBackup({ now: NOW })
      expect(h.settings.has(AUTO_BACKUP_FILE_LAST_KEY)).toBe(false)
      expect(h.settings.has(AUTO_BACKUP_FILE_STATUS_KEY)).toBe(false)
    })
  })

  it('an unchanged run makes no file (nothing new to save)', async () => {
    enableFile()
    await runAutoBackup({ now: NOW })
    h.fileCalls = []
    expect(await runAutoBackup({ now: NOW + 1000, manual: true })).toEqual({ status: 'skipped', reason: 'unchanged' })
    expect(h.fileCalls).toHaveLength(0)
  })

  it('no file is written when the run stops for identity before the local write', async () => {
    enableFile()
    h.afterTier = () => void (h.authSession = { user: { id: 'user-2' } })
    await runAutoBackup({ now: NOW })
    expect(h.fileCalls).toHaveLength(0)
  })

  it('a wipe during the file write: the status is conditional and is not stored, and the run ends as identity-changed', async () => {
    enableFile()
    h.duringFile = () => void h.settings.delete(AUTO_BACKUP_STORE_GUARD_KEY)
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'identity-changed' })
    expect(h.settings.has(AUTO_BACKUP_FILE_STATUS_KEY)).toBe(false)
    expect(h.log.some((l) => l.startsWith('upload'))).toBe(false)
  })

  it('a rotation run still writes exactly one file (old files are never touched)', async () => {
    enableFile()
    h.sessions = Array.from({ length: 10 }, (_, i) => session(`old${i}`, i + 1))
    await runAutoBackup({ now: NOW })
    expect(h.fileCalls).toHaveLength(1)
  })
})

describe('runAutoBackup: rotation at 10', () => {
  it('the 11th automatic backup removes the oldest locally, queues its remote delete and clears the queue once confirmed', async () => {
    h.sessions = Array.from({ length: 10 }, (_, i) => session(`old${i}`, i + 1))
    const out = await runAutoBackup({ now: NOW })
    expect(out).toMatchObject({ status: 'created', pruned: 1 })
    expect(h.log).toContain('remoteDelete:old0:user-1')
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual([])
  })

  it('earlier unconfirmed deletes are retried together with the new ones', async () => {
    h.settings.set(AUTO_BACKUP_PENDING_DELETES_KEY, ['earlier'])
    h.sessions = Array.from({ length: 10 }, (_, i) => session(`old${i}`, i + 1))
    await runAutoBackup({ now: NOW })
    // the flush right after the claim sends the earlier id; the one after the commit sends the rotated-out one
    expect(h.log).toContain('remoteDelete:earlier:user-1')
    expect(h.log).toContain('remoteDelete:old0:user-1')
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual([])
  })
})


describe('runAutoBackup: rotation never prunes the new backup (clock moved back)', () => {
  it('stored backups dated in the future: the new one survives and the count stays 10', async () => {
    h.sessions = Array.from({ length: 10 }, (_, i) => session(`fut${i}`, NOW + (i + 1) * DAY))
    const out = await runAutoBackup({ now: NOW })
    expect(out).toMatchObject({ status: 'created', pruned: 1 })
    const created = (out as { sessionId: string }).sessionId
    const ids = (h.sessions as Session[]).map((s) => s.id)
    expect(ids).toContain(created)
    expect((h.sessions as Session[]).filter(isAutoBackup)).toHaveLength(AUTO_BACKUP_RETENTION_COUNT)
    // the oldest existing one went, not the new one
    expect(ids).not.toContain('fut0')
  })

  it('fewer than 10 existing: nothing is pruned', async () => {
    h.sessions = Array.from({ length: 9 }, (_, i) => session(`o${i}`, 1000 + i))
    expect(await runAutoBackup({ now: NOW })).toMatchObject({ status: 'created', pruned: 0 })
    expect(h.sessions).toHaveLength(10)
  })
})

describe('runAutoBackup: pending ids through updateSettings', () => {
  it('the rotated-out ids are added by a function applied to the stored list inside the commit, keeping earlier ids', async () => {
    h.settings.set(AUTO_BACKUP_PENDING_DELETES_KEY, ['earlier'])
    h.sessions = Array.from({ length: 10 }, (_, i) => session(`old${i}`, 1000 + i))
    h.remoteDeleteResult = false
    await runAutoBackup({ now: NOW })
    const main = h.commits.find((c) => (c as { putSessions?: unknown[] }).putSessions) as { updateSettings: Record<string, (v: unknown) => string[]> }
    expect(typeof main.updateSettings[AUTO_BACKUP_PENDING_DELETES_KEY]).toBe('function')
    expect(main.updateSettings[AUTO_BACKUP_PENDING_DELETES_KEY](['other'])).toEqual(['other', 'old0'])
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual(['earlier', 'old0'])
  })
})

describe('runAutoBackup: accounts that must not get a backup', () => {
  const noBackupNoRequest = () => {
    expect(h.sessions).toEqual([])
    expect(h.log.some((l) => l.startsWith('upload') || l.startsWith('remoteDelete') || l === 'file')).toBe(false)
  }
  it('free account: no backup, no upload', async () => {
    h.tier = 'free'
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'not-entitled' })
    noBackupNoRequest()
  })
  it('signed out: no backup, no request', async () => {
    h.authSession = null
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'signed-out' })
    expect(h.log).not.toContain('fetchTier')
    noBackupNoRequest()
  })
  it('tier unknown (locked or unreachable): no backup, no upload', async () => {
    h.tier = null
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'tier-unknown' })
    noBackupNoRequest()
  })
})

describe('deleteAutoBackup: one transaction', () => {
  it('the local delete and the pending id are ONE commitSessions call', async () => {
    h.sessions = [session('b1', 1)]
    h.remoteDeleteResult = false
    await deleteAutoBackup('b1')
    const first = h.commits[0] as { deleteSessionIds: string[]; updateSettings: Record<string, unknown> }
    expect(first.deleteSessionIds).toEqual(['b1'])
    expect(Object.keys(first.updateSettings)).toEqual([AUTO_BACKUP_PENDING_DELETES_KEY])
  })

  it('nothing is sent when the backup lock is busy; the id stays remembered', async () => {
    const request = vi.fn(async (_n: string, _o: unknown, cb: (l: unknown) => Promise<unknown>) => cb(null))
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    try {
      await deleteAutoBackup('b1')
    } finally {
      vi.unstubAllGlobals()
    }
    expect(h.log.some((l) => l.startsWith('remoteDelete'))).toBe(false)
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual(['b1'])
  })
})

describe('flushPendingRemoteDeletes: ids added during the request', () => {
  it('an id another context adds while the request runs stays on the list; only the sent ids are removed', async () => {
    h.settings.set(AUTO_BACKUP_STORE_GUARD_KEY, 'user-1')
    const { deleteRemoteSessions } = await import('@/lib/sessionUpload')
    vi.mocked(deleteRemoteSessions).mockImplementationOnce(async () => {
      h.settings.set(AUTO_BACKUP_PENDING_DELETES_KEY, [...(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY) as string[]), 'late'])
      return true
    })
    expect(await flushPendingRemoteDeletes('user-1', ['x1'])).toEqual(['late'])
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual(['late'])
  })
})


describe('the sessions self-heal flag: a healthy backup causes no sessions pass', () => {
  const FLAG = SESSIONS_MIGRATION_DONE_KEY

  it('rearmSessionsFlagForBackup is pure: true becomes the backup marker, everything else a plain false', () => {
    expect(REARMED_BY_BACKUP).toBe('')
    expect(rearmSessionsFlagForBackup(true)).toBe(REARMED_BY_BACKUP)
    for (const v of [false, 0, '', undefined, null, 'x', 1]) expect(rearmSessionsFlagForBackup(v)).toBe(false)
    expect(SESSIONS_HEAL_IN_PROGRESS).not.toBe(REARMED_BY_BACKUP)
  })

  it('the flag is written through updateSettings (applied to the stored value), not through settings', async () => {
    await runAutoBackup({ now: NOW })
    const main = h.commits.find((c) => (c as { putSessions?: unknown[] }).putSessions) as { settings: Record<string, unknown>; updateSettings: Record<string, unknown> }
    expect(FLAG in main.settings).toBe(false)
    expect(main.updateSettings[FLAG]).toBe(rearmSessionsFlagForBackup)
  })

  it('flag true before + upload ok: the commit leaves the backup marker, the run compare-and-sets it to true once, the flag ends true', async () => {
    h.settings.set(FLAG, true)
    h.beforeCas = () => expect(h.settings.get(FLAG)).toBe(REARMED_BY_BACKUP)
    expect(await runAutoBackup({ now: NOW })).toMatchObject({ status: 'created', uploaded: true })
    expect(h.casCalls).toEqual([[FLAG, REARMED_BY_BACKUP, true]])
    expect(h.settings.get(FLAG)).toBe(true)
  })

  it.each([
    ['false', false],
    ['the in-progress marker 0', 0],
    ['absent', undefined],
  ])('flag %s before + upload ok: stays false (this run never clears work that was already left)', async (_n, before) => {
    if (before !== undefined) h.settings.set(FLAG, before)
    await runAutoBackup({ now: NOW })
    expect(h.settings.get(FLAG)).toBe(false)
  })

  it('flag true + the upload did not happen: false', async () => {
    h.settings.set(FLAG, true)
    h.uploadResult = false
    await runAutoBackup({ now: NOW })
    expect(h.settings.get(FLAG)).toBe(false)
    expect(h.casCalls).toEqual([])
  })

  it('flag true + the upload threw: false', async () => {
    h.settings.set(FLAG, true)
    h.uploadResult = new Error('network')
    await runAutoBackup({ now: NOW })
    expect(h.settings.get(FLAG)).toBe(false)
  })

  it('flag true + identity lost after the local write: false', async () => {
    h.settings.set(FLAG, true)
    h.beforeSignedIn = (n) => {
      if (n === 2) h.authSession = { user: { id: 'user-2' } }
    }
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'identity-changed' })
    expect(h.settings.get(FLAG)).toBe(false)
  })

  it('flag true + a wipe removes the guard before the commit: nothing is written, the flag stays true', async () => {
    h.settings.set(FLAG, true)
    h.beforeCommit = () => void h.settings.delete(AUTO_BACKUP_STORE_GUARD_KEY)
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'identity-changed' })
    expect(h.settings.get(FLAG)).toBe(true)
  })

  it.each([
    ['false', false],
    ['0', 0],
  ])('a %s written between the commit and the upload confirmation survives', async (_n, rewritten) => {
    h.settings.set(FLAG, true)
    h.duringUpload = () => void h.settings.set(FLAG, rewritten) // a failed save / a pass that started
    await runAutoBackup({ now: NOW })
    expect(h.settings.get(FLAG)).toBe(rewritten)
  })

  it('the markUploaded commit returning false (wiped store): compareAndSetSetting is not called', async () => {
    h.settings.set(FLAG, true)
    h.duringUpload = () => void h.settings.delete(AUTO_BACKUP_STORE_GUARD_KEY)
    expect(await runAutoBackup({ now: NOW })).toMatchObject({ status: 'created', uploaded: true })
    expect(h.casCalls).toEqual([])
  })
})

describe('pending remote deletes are flushed on every path after the claim', () => {
  const sentCalls = () => h.log.filter((l) => l.startsWith('remoteDelete'))
  const seedPending = () => h.settings.set(AUTO_BACKUP_PENDING_DELETES_KEY, ['p1', 'p2'])

  const cases: Array<[string, () => Promise<void> | void, string]> = [
    ['not-due', () => void h.settings.set(AUTO_BACKUP_STATE_KEY, { lastBackupAt: NOW - 1000, fingerprint: 'x', lastBackupId: 'z' }), 'not-due'],
    ['empty', () => void (h.groupsState = { available: [nowOpen] }), 'empty'],
    [
      'unchanged',
      async () => {
        h.sessions = [session('last', NOW - 5 * DAY)]
        h.settings.set(AUTO_BACKUP_STATE_KEY, { lastBackupAt: NOW - 5 * DAY, fingerprint: await fingerprintGroups([group('a'), group('b')]), lastBackupId: 'last' })
      },
      'unchanged',
    ],
    ['tier-unknown', () => void (h.tier = null), 'tier-unknown'],
    ['not-entitled', () => void (h.tier = 'free'), 'not-entitled'],
  ]

  it.each(cases)('%s: the stored ids are sent, and the list is cleared once confirmed', async (_n, arrange, reason) => {
    await arrange()
    seedPending()
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason })
    expect(sentCalls()).toEqual(['remoteDelete:p1,p2:user-1'])
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual([])
  })

  it.each(cases)('%s: ids the server did not confirm stay on the list', async (_n, arrange) => {
    await arrange()
    seedPending()
    h.remoteDeleteResult = false
    await runAutoBackup({ now: NOW })
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual(['p1', 'p2'])
  })

  it.each(cases)('%s: an empty list makes no request', async (_n, arrange) => {
    await arrange()
    await runAutoBackup({ now: NOW })
    expect(sentCalls()).toEqual([])
  })

  it('disabled returns before the claim: nothing is flushed', async () => {
    h.settings.set('appSettings', { autoBackupEnabled: false })
    seedPending()
    expect(await runAutoBackup({ now: NOW })).toEqual({ status: 'skipped', reason: 'disabled' })
    expect(sentCalls()).toEqual([])
    expect(h.settings.get(AUTO_BACKUP_PENDING_DELETES_KEY)).toEqual(['p1', 'p2'])
  })

  it('signed out: nothing is flushed', async () => {
    h.authSession = null
    seedPending()
    await runAutoBackup({ now: NOW })
    expect(sentCalls()).toEqual([])
  })

  it('account mismatch: nothing is flushed', async () => {
    h.settings.set(LAST_USER_ID_KEY, 'user-2')
    seedPending()
    await runAutoBackup({ now: NOW })
    expect(sentCalls()).toEqual([])
  })
})
