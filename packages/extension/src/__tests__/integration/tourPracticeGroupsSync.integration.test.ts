import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { performSync } from '@/lib/syncEngine'
import { setSetting } from '@/lib/localDb'
import { getEncryptionKeyState, getDataKey } from '@/lib/encryptionKey'
import { fakeRemote, type RemoteRow } from './fakeSupabase'
import { testDataKey } from './testEncryption'
import { getGroupsState, markPositionSynced, markGroupSynced, saveGroupsState, updateGroupsState } from '@/lib/localDb'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import type { Group } from '@/lib/types'
import { clearDb } from './dbTestUtils'

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

// The guided tour's practice groups sit in the local order but are never synced, so the position
// pushed for a real group is its index WITHOUT them. Real IndexedDB round trips.

const real = (id: string, extra: Partial<Group> = {}): Group => ({ ...createGroup(id, id), updatedAt: 1000, pendingSync: false, ...extra })
const demo = (id: string): Group => ({ ...createGroup(id, 'Tour demo'), tourDemo: true, pendingSync: false })

const byId = async (id: string) => (await getGroupsState()).available.find((g) => g.id === id)!

beforeEach(async () => {
  fakeRemote.reset()
  await clearDb()
  vi.mocked(getEncryptionKeyState).mockResolvedValue('present')
  vi.mocked(getDataKey).mockResolvedValue(await testDataKey())
})

describe('markPositionSynced / markGroupSynced with practice groups earlier in the order', () => {
  async function seed() {
    const now = createNowOpenGroup()
    await saveGroupsState({
      active: { id: now.id, index: 0 },
      available: [now, demo('tour-demo-1'), demo('tour-demo-2'), real('a', { positionDirty: true }), real('b', { positionDirty: true })],
    })
  }

  it('clears positionDirty when the pushed position is the index among the SYNCED groups', async () => {
    await seed()
    // order: now(0) a(1) b(2) once the two practice groups are left out
    await markPositionSynced('a', 1)
    expect(await byId('a')).not.toHaveProperty('positionDirty')
    await markPositionSynced('b', 2)
    expect(await byId('b')).not.toHaveProperty('positionDirty')
  })

  it('keeps positionDirty when the pushed position is the raw index (practice groups counted)', async () => {
    await seed()
    await markPositionSynced('a', 3)
    expect((await byId('a')).positionDirty).toBe(true)
  })

  it('a content push also clears the position flag by the same numbering', async () => {
    await seed()
    const a = await byId('a')
    await updateGroupsState((s) => ({ ...s, available: s.available.map((g) => (g.id === 'a' ? { ...g, pendingSync: true, updatedAt: 2000 } : g)) }))
    await markGroupSynced('a', 2000, 1, undefined, { ...a, pendingSync: true, updatedAt: 2000 })
    const after = await byId('a')
    expect(after.pendingSync).toBe(false)
    expect(after.positionDirty).toBeUndefined()
  })
})

describe('pulling a remote order with practice groups in the local list', () => {
  const rowOf = (g: Group, position: number): RemoteRow => ({
    id: g.id, user_id: 'user-1', name: g.name, color: g.color, updated_at: BASE,
    windows: g.windows, starred: false, archived: false, note: null, info: g.info ?? '', position,
  })

  it('keeps the practice groups last, adopts the remote order for real groups and claims them synced', async () => {
    const now = createNowOpenGroup()
    const a = real('a', { remoteUpdatedAt: BASE })
    const b = real('b', { remoteUpdatedAt: BASE })
    // local: the practice group sits BETWEEN the real ones
    await saveGroupsState({ active: { id: now.id, index: 0 }, available: [now, a, demo('tour-demo-1'), b] })
    await markPositionSynced('a', 1)
    await markPositionSynced('b', 2)
    // another device moved b before a
    fakeRemote.rows.set('a', rowOf(a, 2))
    fakeRemote.rows.set('b', rowOf(b, 1))
    await setSetting('remoteBaseSeeded', true)
    await setSetting('cloudSyncActive', true)

    await performSync(session)

    const state = await getGroupsState()
    expect(state.available.map((g) => g.id)).toEqual([now.id, 'b', 'a', 'tour-demo-1'])
    // adopting the server's own order is not a change to push back
    expect(state.available.find((g) => g.id === 'a')!.positionDirty).toBeFalsy()
    expect(state.available.find((g) => g.id === 'b')!.positionDirty).toBeFalsy()
    // and the practice group never reached the server
    expect(fakeRemote.rows.has('tour-demo-1')).toBe(false)
  })
})
