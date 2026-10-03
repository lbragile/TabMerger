import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { performSync } from '@/lib/syncEngine'
import { getGroupsState, saveGroupsState, markPositionSynced, setSetting } from '@/lib/localDb'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import type { Group } from '@/lib/types'
import { clearDb } from './dbTestUtils'
import { fakeRemote, type RemoteRow } from './fakeSupabase'

// performSync's merge runs inside updateGroupsState on a fresh read. Real fake-indexeddb +
// real localDb/syncEngine; only the Supabase edge is faked (see fakeSupabase.ts).
vi.mock('@/lib/supabase', async () => {
  const m = await import('./fakeSupabase')
  return { supabase: m.fakeSupabase, isSupabaseConfigured: true }
})
vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: vi.fn(async () => 'present'),
  getDataKey: vi.fn(async () => (await import('./testEncryption')).testDataKey()),
}))

const session = { user: { id: 'user-1' } } as unknown as Session

const synced = (id: string, over: Partial<Group> = {}): Group =>
  ({ ...createGroup(id, `name-${id}`), updatedAt: 1000, pendingSync: false, ...over })

const remoteRow = (g: Group): RemoteRow => ({
  id: g.id, user_id: 'user-1', name: g.name, color: g.color, updated_at: new Date(g.updatedAt).toISOString(),
  windows: g.windows, starred: false, archived: false, note: null, info: g.info ?? '',
})

async function seed(...groups: Group[]) {
  const nowOpen = createNowOpenGroup()
  await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, ...groups] })
  // a write flags every moved/new group positionDirty; these fixtures model groups already in sync
  for (const [i, g] of groups.entries()) await markPositionSynced(g.id, i + 1)
  return nowOpen
}

beforeEach(async () => {
  fakeRemote.reset()
  await clearDb()
})

describe('performSync — atomic merge', () => {
  it('applies a newer remote version and appends remote-only groups after the local drag order', async () => {
    const nowOpen = await seed(synced('b'), synced('a'))
    fakeRemote.rows.set('a', remoteRow(synced('a', { name: 'Remote A', updatedAt: 5000 })))
    fakeRemote.rows.set('b', remoteRow(synced('b')))
    fakeRemote.rows.set('c', remoteRow(synced('c')))

    await performSync(session)

    const s = await getGroupsState()
    expect(s.available.map((g) => g.id)).toEqual([nowOpen.id, 'b', 'a', 'c']) // local order kept, c last
    expect(s.available.find((g) => g.id === 'a')?.name).toBe('Remote A')
  })

  it('drops a previously-synced local group that was deleted remotely, keeps Now Open and unpushed groups', async () => {
    await seed(synced('gone'))
    fakeRemote.rows.clear() // remote has nothing

    await performSync(session)

    const ids = (await getGroupsState()).available.map((g) => g.id)
    expect(ids).not.toContain('gone')
    expect(ids).toHaveLength(1) // Now Open only
  })

  it('adopts the remote sidebar order (position) for groups with no unpushed local change', async () => {
    const nowOpen = await seed(synced('a'), synced('b'), synced('c'))
    // another device reordered to c, a, b and pushed positions (content/updatedAt unchanged)
    fakeRemote.rows.set('c', { ...remoteRow(synced('c')), position: 1 })
    fakeRemote.rows.set('a', { ...remoteRow(synced('a')), position: 2 })
    fakeRemote.rows.set('b', { ...remoteRow(synced('b')), position: 3 })

    await performSync(session)

    expect((await getGroupsState()).available.map((g) => g.id)).toEqual([nowOpen.id, 'c', 'a', 'b'])
    // converged: a second cycle changes nothing and pushes nothing
    fakeRemote.upserts.length = 0
    await performSync(session)
    expect((await getGroupsState()).available.map((g) => g.id)).toEqual([nowOpen.id, 'c', 'a', 'b'])
    expect(fakeRemote.upserts).toHaveLength(0)
  })

  it('breaks position ties deterministically (updatedAt desc, then id) regardless of arrival order', async () => {
    const nowOpen = await seed()
    fakeRemote.rows.set('z', { ...remoteRow(synced('z', { updatedAt: 1000 })), position: 1 })
    fakeRemote.rows.set('m', { ...remoteRow(synced('m', { updatedAt: 3000 })), position: 1 })
    fakeRemote.rows.set('b', { ...remoteRow(synced('b', { updatedAt: 1000 })), position: 1 })

    await performSync(session)

    expect((await getGroupsState()).available.map((g) => g.id)).toEqual([nowOpen.id, 'm', 'b', 'z'])
  })

  it('a push sends the local sidebar index as position, and the reordered result survives the pull of its own push', async () => {
    const nowOpen = await seed(synced('a', { pendingSync: true }), synced('b', { pendingSync: true }))
    await performSync(session)
    expect(fakeRemote.rows.get('a')?.position).toBe(1)
    expect(fakeRemote.rows.get('b')?.position).toBe(2)
    expect((await getGroupsState()).available.map((g) => g.id)).toEqual([nowOpen.id, 'a', 'b'])
  })

  it('a group deleted locally while the pull is in flight is not resurrected by that pull, and is deleted remotely next cycle', async () => {
    const nowOpen = await seed(synced('g1'))
    fakeRemote.rows.set('g1', remoteRow(synced('g1')))

    await setSetting('cloudSyncActive', true) // set by useSync while a cloud-sync user is signed in
    const gate = fakeRemote.hold('select')
    const sync = performSync(session)
    await gate.entered // pending-delete set was empty when this cycle started
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: s.available.filter((g) => g.id !== 'g1') }) // marker written with the delete
    gate.release()
    await sync

    expect((await getGroupsState()).available.map((g) => g.id)).toEqual([nowOpen.id])
    expect(fakeRemote.rows.has('g1')).toBe(true) // the DELETE has not been sent yet...
    await performSync(session)
    expect(fakeRemote.rows.has('g1')).toBe(false) // ...the next cycle sends it
    expect((await getGroupsState()).available.map((g) => g.id)).toEqual([nowOpen.id])
  })
})
