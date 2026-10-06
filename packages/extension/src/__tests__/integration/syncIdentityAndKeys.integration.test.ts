import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { encryptBlob, generateDataKey, isEncryptedBlob } from '@tabmerger/shared'
import { performSync, performSyncCycle, pushPendingChanges } from '@/lib/syncEngine'
import { getGroupsState, saveGroupsState, updateGroupsState, markPositionSynced, setSetting, getSetting, clearLocalAccountData } from '@/lib/localDb'
import { getEncryptionKeyState, getDataKey, reportUndecryptableRows } from '@/lib/encryptionKey'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import type { Group } from '@/lib/types'
import { clearDb } from './dbTestUtils'
import { fakeRemote, type RemoteRow } from './fakeSupabase'
import { testDataKey, remoteName } from './testEncryption'

// Final audit pass: a sync cycle must survive rows it cannot read, must never treat an answer given
// to the WRONG identity as the account's data, and must never push one account's groups into another.

vi.mock('@/lib/supabase', async () => {
  const m = await import('./fakeSupabase')
  return { supabase: m.fakeSupabase, isSupabaseConfigured: true }
})
vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: vi.fn(async () => 'present'),
  getDataKey: vi.fn(async () => (await import('./testEncryption')).testDataKey()),
  reportUndecryptableRows: vi.fn(async () => undefined),
}))

const session = { user: { id: 'user-1' } } as unknown as Session
const BASE = '2030-01-01T00:00:00.000Z'

const grp = (id: string, name: string): Group => ({ ...createGroup(id, name), updatedAt: 1000, pendingSync: false })
const rowOf = (g: Group, stamp = BASE, position = 1): RemoteRow => ({
  id: g.id, user_id: 'user-1', name: g.name, color: g.color, updated_at: stamp,
  windows: g.windows, starred: false, archived: false, note: null, info: g.info ?? '', position,
})

/** Clean local groups that are also on the server (plaintext rows unless a test replaces them). */
async function seed(...groups: Group[]) {
  const nowOpen = createNowOpenGroup()
  await saveGroupsState({
    active: { id: nowOpen.id, index: 0 },
    available: [nowOpen, ...groups.map((g) => ({ ...g, remoteUpdatedAt: BASE, pendingSync: false }))],
  })
  for (const [i, g] of groups.entries()) {
    await markPositionSynced(g.id, i + 1)
    fakeRemote.rows.set(g.id, rowOf(g, BASE, i + 1))
  }
  await setSetting('remoteBaseSeeded', true)
  await setSetting('cloudSyncActive', true)
}

const names = async () => (await getGroupsState()).available.map((g) => g.name)
const ids = async () => (await getGroupsState()).available.slice(1).map((g) => g.id)

/** A row another device encrypted under a DIFFERENT key (e.g. the key from before a passphrase reset). */
async function otherKeyRow(g: Group, position: number): Promise<RemoteRow> {
  const { iv, ct } = await encryptBlob(await generateDataKey(), { name: g.name, windows: g.windows, note: null, info: '' })
  return { ...rowOf(g, BASE, position), name: '', windows: { v: 1, iv, ct } }
}

beforeEach(async () => {
  fakeRemote.reset()
  await clearDb()
  vi.mocked(getEncryptionKeyState).mockResolvedValue('present')
  vi.mocked(getDataKey).mockResolvedValue(await testDataKey())
  vi.mocked(reportUndecryptableRows).mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('H1 a row that cannot be decrypted', () => {
  it('does not abort the pull: it is treated like a locked row (kept locally, never "deleted remotely"), the other rows merge', async () => {
    await seed(grp('mine', 'Mine'), grp('stale', 'Stale key'))
    fakeRemote.rows.set('stale', await otherKeyRow(grp('stale', 'Stale key'), 2))
    fakeRemote.rows.set('new', rowOf(grp('new', 'From another device'), BASE, 3))

    await expect(performSync(session)).resolves.toBeDefined()

    expect((await ids()).sort()).toEqual(['mine', 'new', 'stale']) // nothing dropped, the readable remote row adopted
    expect((await names()).includes('Stale key')).toBe(true) // the local copy stands in for the unreadable row
    expect(fakeRemote.rows.has('stale')).toBe(true)
    expect(fakeRemote.deleteCalls).toEqual([])
    expect(await getSetting('pendingDeleteGroupIds', [])).toEqual([])
    // the key store is told, so a key that was never verified against the server row can be re-checked
    expect(reportUndecryptableRows).toHaveBeenCalledTimes(1)
  })

  it('a remote-only unreadable row is skipped every cycle without blocking sync or being deleted', async () => {
    await seed(grp('mine', 'Mine'))
    fakeRemote.rows.set('orphan', await otherKeyRow(grp('orphan', 'Nobody can read me'), 2))

    await performSync(session)
    await updateGroupsState((s) => ({ ...s, available: [...s.available, { ...createGroup('fresh', 'Fresh'), pendingSync: true }] }))
    await performSync(session)

    expect(await ids()).toEqual(['mine', 'fresh'])
    expect(await remoteName('fresh')).toBe('Fresh') // pushes still go through
    expect(fakeRemote.rows.has('orphan')).toBe(true) // user data is never deleted silently
  })

  it('a realtime event for an unreadable row is ignored instead of throwing', async () => {
    const { subscribeToRemoteChanges } = await import('@/lib/syncEngine')
    await seed(grp('mine', 'Mine'))
    const onUpdate = vi.fn()
    await subscribeToRemoteChanges(session, onUpdate)

    await expect(fakeRemote.realtimeCb!({ eventType: 'UPDATE', new: await otherKeyRow(grp('mine', 'Rewritten'), 1) })).resolves.toBeUndefined()

    expect(onUpdate).not.toHaveBeenCalled()
    expect(await names()).toContain('Mine')
  })
})

describe('M1 an answer given to the wrong identity is not the account data', () => {
  it('an empty pull after the session was lost mid-cycle merges nothing: no group dropped, no conflict copy', async () => {
    await seed(grp('a', 'A'), grp('b', 'B'))
    await updateGroupsState((s) => ({ ...s, available: s.available.map((g) => (g.id === 'b' ? { ...g, name: 'B edited', pendingSync: true, updatedAt: 2000 } : g)) }))
    await setSetting('lastSignedInUserId', 'user-1')

    const gate = fakeRemote.hold('select')
    const cycle = performSyncCycle(session)
    await gate.entered
    fakeRemote.sessionUserId = null // signed out / token refresh failed: the pull is answered as anon, with zero rows
    gate.release()
    const result = await cycle

    expect(await ids()).toEqual(['a', 'b'])
    expect(await names()).not.toContain('B edited (conflict copy)')
    expect(result.status).toBe('identity-changed')
    expect(await getSetting('pendingDeleteGroupIds', [])).toEqual([])
  })

  it('a cycle started for a session the client no longer holds sends nothing', async () => {
    await seed(grp('a', 'A'))
    await updateGroupsState((s) => ({ ...s, available: [...s.available, { ...createGroup('n1', 'New'), pendingSync: true }] }))
    fakeRemote.sessionUserId = 'someone-else'

    const result = await performSyncCycle(session)

    expect(result.status).toBe('identity-changed')
    expect(fakeRemote.writes).toEqual([])
    expect(fakeRemote.selects).toEqual([])
    expect(await ids()).toEqual(['a', 'n1'])
  })
})

describe('M2 the store belongs to another account', () => {
  it('the cycle is skipped: account A\'s local groups are never pushed into account B', async () => {
    await seed()
    await updateGroupsState((s) => ({ ...s, available: [...s.available, { ...createGroup('a1', 'Belongs to A'), pendingSync: true }] }))
    await setSetting('lastSignedInUserId', 'account-A') // the popup has not switched (wiped) the store yet

    const result = await performSyncCycle(session) // session = user-1, bridged in by the web app

    expect(result.status).toBe('account-mismatch')
    expect(fakeRemote.writes).toEqual([])
    expect(fakeRemote.rows.size).toBe(0)
    expect((await getGroupsState()).available[1]).toMatchObject({ id: 'a1', pendingSync: true })
  })

  it('the push itself refuses to run for a user who does not own the store', async () => {
    await seed()
    await updateGroupsState((s) => ({ ...s, available: [...s.available, { ...createGroup('a1', 'Belongs to A'), pendingSync: true }] }))
    await setSetting('lastSignedInUserId', 'account-A')

    await pushPendingChanges(session)

    expect(fakeRemote.writes).toEqual([])
  })
})

describe('L1 a legacy plaintext row is still re-encrypted after a content-equal adopt', () => {
  it('keeps the group pending when the remote copy is plaintext, so the next push stores ciphertext', async () => {
    await seed(grp('g1', 'Same'))
    // after encryption setup every group is pending; meanwhile the plaintext row's stamp moved (same content)
    await updateGroupsState((s) => ({ ...s, available: s.available.map((g) => (g.id === 'g1' ? { ...g, pendingSync: true } : g)) }))
    fakeRemote.rows.set('g1', rowOf(grp('g1', 'Same'), '2030-01-01T00:05:00.000Z'))

    await performSync(session) // push loses the compare-and-swap; the merge adopts the equal content
    await performSync(session) // the re-encrypt push

    expect(isEncryptedBlob(fakeRemote.rows.get('g1')?.windows)).toBe(true)
    expect(fakeRemote.rows.get('g1')?.name).toBe('')
    expect(await names()).not.toContain('Same (conflict copy)')
    expect((await getGroupsState()).available[1].pendingSync).toBe(false)
  })
})

describe('L5 a failed legacy probe is not "the row does not exist"', () => {
  it('skips that group for this cycle instead of inserting over a row it could not look up', async () => {
    const nowOpen = createNowOpenGroup()
    await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, { ...grp('g1', 'Old pending'), pendingSync: true }] })
    fakeRemote.rows.set('g1', rowOf(grp('g1', 'Old pending')))
    fakeRemote.failProbe = true // remoteBaseSeeded is unset: this is the legacy (probing) window

    await pushPendingChanges(session)

    expect(fakeRemote.writes).toEqual([])
    expect((await getGroupsState()).available[1]).toMatchObject({ id: 'g1', pendingSync: true })
  })
})

describe('L6 per-account sync flags do not survive an account switch', () => {
  it('the account wipe clears the migration flags, the base-seeded flag and the delete backoff', async () => {
    await setSetting('encryptionMigrationDone', true)
    await setSetting('sessionsEncryptionMigrationDone', true)
    await setSetting('remoteBaseSeeded', true)
    await setSetting('pendingDeleteBackoff', { failures: 3, nextAt: 9e15 })
    await setSetting('appSettings', { theme: 'dark' })

    await clearLocalAccountData()

    expect(await getSetting('encryptionMigrationDone', false)).toBe(false)
    expect(await getSetting('sessionsEncryptionMigrationDone', false)).toBe(false)
    expect(await getSetting('remoteBaseSeeded', false)).toBe(false)
    expect(await getSetting('pendingDeleteBackoff', null)).toBeNull()
    expect(await getSetting('appSettings', {})).toEqual({ theme: 'dark' }) // device-level settings stay
  })
})

describe('the pull does not depend on the server page cap', () => {
  it('reads every row when the server returns fewer rows per page than requested (max_rows < page size)', async () => {
    await seed()
    for (let i = 0; i < 1100; i++) {
      const g = grp(`bulk${i}`, `B${i}`)
      fakeRemote.rows.set(g.id, rowOf(g, BASE, i + 1))
    }
    fakeRemote.maxRows = 400

    await performSync(session)

    expect((await getGroupsState()).available).toHaveLength(1101)
    expect(fakeRemote.selects).toHaveLength(3) // 400 + 400 + 300, and no extra empty page
    expect(fakeRemote.deleteCalls).toEqual([])
  })
})
