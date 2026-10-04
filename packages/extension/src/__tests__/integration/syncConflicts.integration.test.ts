import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { CONFLICT_COPY_SUFFIX } from '@tabmerger/shared'
import { performSync, subscribeToRemoteChanges } from '@/lib/syncEngine'
import { getGroupsState, saveGroupsState, markPositionSynced, setSetting } from '@/lib/localDb'
import { onSyncConflict, onForeignGroupsChange } from '@/lib/foreignChange'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import { getEncryptionKeyState, getDataKey } from '@/lib/encryptionKey'
import type { Group } from '@/lib/types'
import { clearDb } from './dbTestUtils'
import { fakeRemote, type RemoteRow } from './fakeSupabase'
import { testDataKey, remoteName, remoteNames, encryptRemoteRow } from './testEncryption'

// M6 "keep both": compare-and-swap pushes against a per-group server base stamp; a conflict keeps the
// server copy as the group and saves this device's edit as "<name> (conflict copy)". Real
// fake-indexeddb + real localDb/syncEngine; only the Supabase edge and the key are faked.

vi.mock('@/lib/supabase', async () => {
  const m = await import('./fakeSupabase')
  return { supabase: m.fakeSupabase, isSupabaseConfigured: true }
})
vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: vi.fn(async () => 'present'),
  getDataKey: vi.fn(async () => (await import('./testEncryption')).testDataKey()),
}))

const session = { user: { id: 'user-1' } } as unknown as Session
const BASE = '2030-01-01T00:00:00.000Z'

const rowOf = (g: Group, stamp = BASE, position = 1): RemoteRow => ({
  id: g.id, user_id: 'user-1', name: g.name, color: g.color, updated_at: stamp,
  windows: g.windows, starred: false, archived: false, note: null, info: g.info ?? '', position,
})

/** Device state: Now Open + groups that were synced when the server stamp was BASE. */
async function seed(...groups: Group[]) {
  const nowOpen = createNowOpenGroup()
  const withBase = groups.map((g) => ({ ...g, remoteUpdatedAt: BASE, pendingSync: false }))
  await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, ...withBase] })
  const { markGroupSynced } = await import('@/lib/localDb')
  void markGroupSynced
  for (const [i, g] of groups.entries()) {
    await markPositionSynced(g.id, i + 1)
    fakeRemote.rows.set(g.id, rowOf(g, BASE, i + 1))
  }
  await setSetting('remoteBaseSeeded', true)
  await setSetting('cloudSyncActive', true)
}

const edit = async (id: string, patch: Partial<Group>) => {
  const s = await getGroupsState()
  await saveGroupsState({ ...s, available: s.available.map((g) => (g.id === id ? { ...g, ...patch, updatedAt: Date.now(), pendingSync: true } : g)) })
}

const ids = async () => (await getGroupsState()).available.map((g) => g.name)
const grp = (id: string, name: string) => ({ ...createGroup(id, name), updatedAt: 1000, pendingSync: false })

beforeEach(async () => {
  fakeRemote.reset()
  await clearDb()
  vi.mocked(getEncryptionKeyState).mockResolvedValue('present')
  vi.mocked(getDataKey).mockResolvedValue(await testDataKey())
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('M6 keep both on a sync conflict', () => {
  it('two devices edit the same group: the server copy stays, this edit becomes "<name> (conflict copy)" right after it', async () => {
    await seed(grp('g1', 'Orig'), grp('g2', 'Other'))
    await edit('g1', { name: 'Mine' }) // device A edit, unpushed
    fakeRemote.serverEdit('g1', { name: 'Theirs' }) // device B pushed first
    const conflicts = vi.fn()
    const off = onSyncConflict(conflicts)

    await performSync(session)
    await performSync(session) // the copy is a new pending group and goes out on the next push

    const names = await ids()
    expect(names.slice(1)).toEqual(['Theirs', `Mine${CONFLICT_COPY_SUFFIX}`, 'Other'])
    const state = (await getGroupsState()).available
    expect(state[1].pendingSync).toBeFalsy()
    expect(state[2].pendingSync).toBeFalsy() // pushed
    expect(await remoteName('g1')).toBe('Theirs') // B's version was never overwritten
    expect((await remoteNames()).sort()).toEqual(['Mine (conflict copy)', 'Other', 'Theirs'])
    expect(conflicts).toHaveBeenCalledWith(['Mine'])
    off()
  })

  it('equal content (e.g. only a reorder bumped updated_at elsewhere): no copy, base adopted, pending cleared', async () => {
    const g1 = grp('g1', 'Same')
    await seed(g1)
    await encryptRemoteRow('g1') // the server copy is ciphertext (a legacy plaintext row would stay pending to be re-encrypted)
    await edit('g1', { name: 'Same', note: undefined }) // pending, but same content
    fakeRemote.serverEdit('g1', {}) // stamp bumped, content identical
    await performSync(session)
    const state = (await getGroupsState()).available
    expect(state.map((g) => g.name)).toEqual([state[0].name, 'Same'])
    expect(state[1].pendingSync).toBeFalsy()
    expect(state[1].remoteUpdatedAt).toBe(fakeRemote.rows.get('g1')?.updated_at)
  })

  it('remote deleted + local edit: the edit survives as a new group with the suffix, the old id is dropped', async () => {
    await seed(grp('g1', 'Orig'))
    await edit('g1', { name: 'Mine' })
    fakeRemote.rows.delete('g1') // deleted on the other device
    await performSync(session)
    await performSync(session)
    const state = (await getGroupsState()).available
    expect(state.slice(1).map((g) => g.name)).toEqual([`Mine${CONFLICT_COPY_SUFFIX}`])
    expect(state[1].id).not.toBe('g1')
    expect(fakeRemote.rows.has('g1')).toBe(false)
    expect((await remoteNames())).toEqual(['Mine (conflict copy)'])
  })

  it('legacy upgrade: a pending edit on a row this device never stamped is pushed once, with no copy', async () => {
    // pre-upgrade state: the group has no remoteUpdatedAt and the seeding flag is unset
    const nowOpen = createNowOpenGroup()
    const g1 = { ...grp('g1', 'Mine'), pendingSync: true }
    await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, g1] })
    fakeRemote.rows.set('g1', rowOf(grp('g1', 'Older remote'), '2029-06-01T00:00:00.000Z'))

    await performSync(session)

    expect((await getGroupsState()).available.map((g) => g.name).slice(1)).toEqual(['Mine'])
    expect(fakeRemote.upserts.filter((u) => u.id === 'g1')).toHaveLength(1) // exactly one write
    expect(await remoteName('g1')).toBe('Mine')
    const after = (await getGroupsState()).available[1]
    expect(after.pendingSync).toBeFalsy()
    expect(after.remoteUpdatedAt).toBe(fakeRemote.rows.get('g1')?.updated_at) // base stored
  })

  it('an own push followed by its realtime echo is not a conflict', async () => {
    await seed(grp('g1', 'Orig'))
    await edit('g1', { name: 'Mine' })
    await performSync(session) // CAS push ok -> base := the new server stamp
    const pushed = (await getGroupsState()).available[1]
    expect(pushed.pendingSync).toBeFalsy()
    expect(pushed.remoteUpdatedAt).toBe(fakeRemote.rows.get('g1')?.updated_at)

    const onUpdate = vi.fn()
    await subscribeToRemoteChanges(session, onUpdate)
    await fakeRemote.realtimeCb!({ eventType: 'UPDATE', new: fakeRemote.rows.get('g1') })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(await ids()).not.toContain(`Mine${CONFLICT_COPY_SUFFIX}`)
  })

  it('an edit made while the push was in flight keeps its pending flag AND the new base: no self-conflict afterwards', async () => {
    await seed(grp('g1', 'Orig'))
    await edit('g1', { name: 'v1' })
    const gate = fakeRemote.hold('upsert')
    const sync = performSync(session)
    await gate.entered
    await edit('g1', { name: 'v2' })
    gate.release()
    await sync
    const mid = (await getGroupsState()).available[1]
    expect(mid.pendingSync).toBe(true)
    expect(mid.remoteUpdatedAt).toBe(fakeRemote.rows.get('g1')?.updated_at)
    await performSync(session)
    expect(await remoteName('g1')).toBe('v2')
    expect((await ids()).filter((n) => n.includes(CONFLICT_COPY_SUFFIX))).toHaveLength(0)
  })

  it('a failed cycle does not duplicate the copy: one conflict -> exactly one copy across retries', async () => {
    await seed(grp('g1', 'Orig'))
    await edit('g1', { name: 'Mine' })
    fakeRemote.serverEdit('g1', { name: 'Theirs' })
    fakeRemote.failInsert = true // the copy cannot be pushed yet
    await performSync(session)
    await performSync(session)
    fakeRemote.failInsert = false
    await performSync(session)
    await performSync(session)
    expect((await ids()).filter((n) => n.includes(CONFLICT_COPY_SUFFIX))).toHaveLength(1)
    expect((await remoteNames()).filter((n) => n.includes(CONFLICT_COPY_SUFFIX))).toHaveLength(1)
  })

  it('a locked encrypted remote row is not resolved: the edit stays pending, no copy, retried next cycle', async () => {
    vi.mocked(getEncryptionKeyState).mockResolvedValue('present')
    vi.mocked(getDataKey).mockResolvedValue(null)
    await seed(grp('g1', 'Orig'))
    await edit('g1', { name: 'Mine' })
    fakeRemote.serverEdit('g1', { windows: { v: 1, iv: 'iv', ct: 'ct' } })
    const foreign = vi.fn()
    const off = onForeignGroupsChange(foreign)
    await performSync(session)
    const state = (await getGroupsState()).available
    expect(state.map((g) => g.name).slice(1)).toEqual(['Mine'])
    expect(state[1].pendingSync).toBe(true)
    expect(foreign).not.toHaveBeenCalled()
    off()
  })

  it('own position-only push does not make the next content push look like a conflict (pre-020 trigger bumps updated_at)', async () => {
    await seed(grp('g1', 'A'), grp('g2', 'B'))
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: [s.available[0], s.available[2], s.available[1]] }) // reorder
    await performSync(session) // position-only updates (stamps bumped by the trigger)
    await edit('g1', { name: 'A edited' })
    await performSync(session)
    expect(await remoteName('g1')).toBe('A edited')
    expect((await ids()).filter((n) => n.includes(CONFLICT_COPY_SUFFIX))).toHaveLength(0)
  })
})
