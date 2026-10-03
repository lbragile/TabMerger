import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { Session } from '@supabase/supabase-js'
import { performSync, subscribeToRemoteChanges } from '@/lib/syncEngine'
import { onForeignGroupsChange } from '@/lib/foreignChange'
import { toast } from '@/lib/toast'
import { trackEvent } from '@/lib/analytics'
import { getGroupsState, saveGroupsState, markPositionSynced, setSetting } from '@/lib/localDb'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import { useUpdateGroupName, useGroups } from '@/hooks/useGroups'
import { getEncryptionKeyState, getDataKey } from '@/lib/encryptionKey'
import type { Group } from '@/lib/types'
import { clearDb } from './dbTestUtils'
import { fakeRemote, type RemoteRow } from './fakeSupabase'
import { testDataKey, remoteName } from './testEncryption'

// Sync-conflict-auditor findings (N1-N12) against real fake-indexeddb + real localDb/syncEngine/hooks;
// only the Supabase edge and the encryption key are faked.

vi.mock('@/lib/supabase', async () => {
  const m = await import('./fakeSupabase')
  return { supabase: m.fakeSupabase, isSupabaseConfigured: true }
})
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: vi.fn(async () => 'present'),
  getDataKey: vi.fn(async () => (await import('./testEncryption')).testDataKey()),
  ENCRYPTION_MIGRATION_DONE_KEY: 'encryptionMigrationDone',
  SESSIONS_MIGRATION_DONE_KEY: 'sessionsEncryptionMigrationDone',
}))

const session = { user: { id: 'user-1' } } as unknown as Session

const synced = (id: string, over: Partial<Group> = {}): Group =>
  ({ ...createGroup(id, `name-${id}`), updatedAt: 1000, pendingSync: false, ...over })

const remoteRow = (g: Group, position?: number): RemoteRow => ({
  id: g.id, user_id: 'user-1', name: g.name, color: g.color, updated_at: new Date(g.updatedAt).toISOString(),
  windows: g.windows, starred: false, archived: false, note: null, info: g.info ?? '',
  ...(position === undefined ? {} : { position }),
})

/** Seeds Now Open + groups as ALREADY in sync (no pending flag, positions pushed). */
async function seedSynced(...groups: Group[]) {
  const nowOpen = createNowOpenGroup()
  await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, ...groups] })
  for (const [i, g] of groups.entries()) await markPositionSynced(g.id, i + 1)
  groups.forEach((g, i) => fakeRemote.rows.set(g.id, remoteRow(g, i + 1)))
  return nowOpen
}

const reorder = async (ids: string[]) => {
  const s = await getGroupsState()
  const byId = new Map(s.available.map((g) => [g.id, g]))
  await saveGroupsState({ ...s, available: [s.available[0], ...ids.map((id) => byId.get(id)!)] })
}

const flags = async () => Object.fromEntries((await getGroupsState()).available.map((g) => [g.id, { p: !!g.pendingSync, d: !!g.positionDirty }]))

beforeEach(async () => {
  fakeRemote.reset()
  await clearDb()
  await setSetting('cloudSyncActive', true) // a signed-in cloud-sync user: local deletes are remembered for the server
  vi.mocked(getEncryptionKeyState).mockResolvedValue('present')
  vi.mocked(getDataKey).mockResolvedValue(await testDataKey())
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('N1/N2/N7 reorders push only `position`, derived from the order', () => {
  it('a reorder flags positionDirty (not pendingSync) on every group whose index changed', async () => {
    await seedSynced(synced('a'), synced('b'), synced('c'))
    await reorder(['c', 'a', 'b'])
    expect(await flags()).toMatchObject({ a: { p: false, d: true }, b: { p: false, d: true }, c: { p: false, d: true } })
  })

  it('pushes a reorder as position-only updates and never upserts content (a newer remote edit is kept)', async () => {
    const a = synced('a')
    await seedSynced(a, synced('b'))
    // another device edited `a` meanwhile: server row is newer than this device's copy
    fakeRemote.rows.set('a', { ...remoteRow(a, 1), name: 'Edited elsewhere', updated_at: new Date(9000).toISOString() })
    await reorder(['b', 'a'])

    await performSync(session)

    expect(fakeRemote.upserts).toHaveLength(0) // this device's stale content was NOT pushed
    expect(fakeRemote.updates.map((u) => [u.id, u.patch])).toEqual(expect.arrayContaining([['b', { position: 1 }], ['a', { position: 2 }]]))
    expect(await remoteName('a')).toBe('Edited elsewhere')
    expect((await getGroupsState()).available.find((g) => g.id === 'a')?.name).toBe('Edited elsewhere') // and pulled back
    expect(await flags()).toMatchObject({ a: { d: false }, b: { d: false } }) // cleared after the push
  })

  it('pushes positions while the encryption key is locked (position is plaintext)', async () => {
    vi.mocked(getEncryptionKeyState).mockResolvedValue('present')
    vi.mocked(getDataKey).mockResolvedValue(null)
    await seedSynced(synced('a'), synced('b'))
    await reorder(['b', 'a'])
    await performSync(session)
    expect(fakeRemote.updates.map((u) => u.id).sort()).toEqual(['a', 'b'])
    expect(fakeRemote.upserts).toHaveLength(0)
  })

  it('N2: a reorder made while the push was in flight keeps positionDirty (only a matching index clears it)', async () => {
    const { markPositionSynced: markSynced } = await import('@/lib/localDb')
    await seedSynced(synced('a'), synced('b'), synced('c'))
    await reorder(['b', 'a', 'c']) // a is now at index 2
    await markSynced('a', 1) // an older push (position 1) finishes after the group moved on
    expect((await flags()).a.d).toBe(true)
    await markSynced('a', 2)
    expect((await flags()).a.d).toBe(false)
  })

  it('N7: deleting a group renumbers the shifted ones, and the pushed positions stay contiguous', async () => {
    await seedSynced(synced('a'), synced('b'), synced('c'), synced('d'))
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: s.available.filter((g) => g.id !== 'b') }) // c, d shift up
    expect(await flags()).toMatchObject({ a: { d: false }, c: { d: true }, d: { d: true } })

    await performSync(session)

    expect(['a', 'c', 'd'].map((id) => fakeRemote.rows.get(id)?.position)).toEqual([1, 2, 3])
  })

  it('N7: a newly appended group never collides with a stale remote position', async () => {
    await seedSynced(synced('a'), synced('b'), synced('c'))
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: s.available.filter((g) => g.id !== 'a') }) // b->1, c->2
    await saveGroupsState({ ...(await getGroupsState()), available: [...(await getGroupsState()).available, createGroup('n', 'New')] }) // n->3
    await performSync(session)
    const positions = ['b', 'c', 'n'].map((id) => fakeRemote.rows.get(id)?.position)
    expect(positions).toEqual([1, 2, 3])
    // and this device's own order survives its next pull
    expect((await getGroupsState()).available.map((g) => g.id).slice(1)).toEqual(['b', 'c', 'n'])
  })
})

describe('N3 a local unpushed edit beats a newer server stamp', () => {
  it('keeps a group edited during the pull round trip even though the remote row looks newer', async () => {
    await seedSynced(synced('g1', { name: 'Old' }))
    fakeRemote.rows.set('g1', { ...remoteRow(synced('g1', { name: 'Old' }), 1), updated_at: new Date(Date.now() + 60_000).toISOString() })
    const gate = fakeRemote.hold('select')
    const sync = performSync(session)
    await gate.entered
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: s.available.map((g) => (g.id === 'g1' ? { ...g, name: 'Edited', updatedAt: Date.now(), pendingSync: true } : g)) })
    gate.release()
    await sync
    const after = (await getGroupsState()).available.find((g) => g.id === 'g1')
    expect(after?.name).toBe('Edited')
    expect(after?.pendingSync).toBe(true)
  })
})

describe('N12 locked rows and no-op pulls', () => {
  it('does not delete a clean local group whose remote row is encrypted but locked', async () => {
    vi.mocked(getEncryptionKeyState).mockResolvedValue('present')
    vi.mocked(getDataKey).mockResolvedValue(null)
    await seedSynced(synced('g1'))
    fakeRemote.rows.set('g1', { ...remoteRow(synced('g1'), 1), windows: { v: 1, iv: 'iv', ct: 'ct' } })
    await performSync(session)
    expect((await getGroupsState()).available.map((g) => g.id)).toContain('g1')
  })

  it('a pull that changes nothing neither writes nor bumps the rev (no 30 s broadcast churn)', async () => {
    await seedSynced(synced('a'), synced('b'))
    await performSync(session) // settle
    const before = (await getGroupsState()).rev
    const sendMessage = vi.fn()
    ;(globalThis as unknown as { chrome: unknown }).chrome = { runtime: { sendMessage } }
    await performSync(session)
    delete (globalThis as { chrome?: unknown }).chrome
    expect((await getGroupsState()).rev).toBe(before)
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

describe('N9 sync of another account is not merged into this store', () => {
  it('skips the merge when the store belongs to a different signed-in account', async () => {
    await seedSynced(synced('mine'))
    await setSetting('lastSignedInUserId', 'someone-else')
    fakeRemote.rows.set('theirs', remoteRow(synced('theirs'), 2))
    await performSync(session) // session.user.id === 'user-1'
    expect((await getGroupsState()).available.map((g) => g.id)).not.toContain('theirs')
  })
})

describe('N10 mutators address the group by id, not by a stale index', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children)

  it('renames the group the user clicked even if the stored order changed since the cache was read', async () => {
    await seedSynced(synced('a'), synced('b'), synced('c'))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const w = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
    const { result: groups } = renderHook(() => useGroups(), { wrapper: w })
    await waitFor(() => expect(groups.current.isSuccess).toBe(true))
    expect(groups.current.data?.available[1].id).toBe('a') // what the user sees at index 1

    await reorder(['c', 'a', 'b']) // a sync/worker reorders the stored list; the cache is still stale

    const { result: rename } = renderHook(() => useUpdateGroupName(), { wrapper: w })
    await rename.current.mutateAsync({ groupIndex: 1, name: 'Renamed' })

    const after = (await getGroupsState()).available
    expect(after.find((g) => g.id === 'a')?.name).toBe('Renamed')
    expect(after.find((g) => g.id === 'c')?.name).toBe('name-c')
    void wrapper
  })
})

describe('N8 pending remote deletes are bounded, chunked and backed off', () => {
  it('retries a failed DELETE with exponential backoff instead of every poll', async () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1_000_000)
    await seedSynced(synced('g1'))
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: s.available.filter((g) => g.id !== 'g1') }) // pending-delete recorded
    fakeRemote.failDelete = true

    await performSync(session) // attempt 1 fails
    expect(fakeRemote.deleteCalls).toHaveLength(1)
    await performSync(session) // inside the backoff window: not retried
    expect(fakeRemote.deleteCalls).toHaveLength(1)

    now.mockReturnValue(1_000_000 + 31_000) // past the first 30 s
    await performSync(session)
    expect(fakeRemote.deleteCalls).toHaveLength(2)

    fakeRemote.failDelete = false
    now.mockReturnValue(1_000_000 + 31_000 + 61_000) // past the doubled 60 s
    await performSync(session)
    expect(fakeRemote.deleteCalls).toHaveLength(3)
    expect(fakeRemote.rows.has('g1')).toBe(false)
    now.mockRestore()
  })

  it('does not record deletes while no cloud-sync user is active', async () => {
    await setSetting('cloudSyncActive', false)
    await seedSynced(synced('g1'))
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: s.available.filter((g) => g.id !== 'g1') })
    const { getPendingGroupDeletes } = await import('@/lib/localDb')
    expect(await getPendingGroupDeletes()).toEqual([])
  })

  it('caps the pending set, dropping the oldest ids', async () => {
    const { addPendingGroupDeletes, getPendingGroupDeletes } = await import('@/lib/localDb')
    await addPendingGroupDeletes(Array.from({ length: 520 }, (_, i) => `old${i}`))
    const ids = await getPendingGroupDeletes()
    expect(ids).toHaveLength(500)
    expect(ids[0]).toBe('old20')
    expect(ids.at(-1)).toBe('old519')
  })
})

describe('M1 legacy rows (position column default 0) never scramble the local order', () => {
  it('keeps a custom local order when every remote row is at position 0, and pushes it as 1..n', async () => {
    const a = synced('a', { updatedAt: 1000 })
    const b = synced('b', { updatedAt: 3000 })
    const c = synced('c', { updatedAt: 2000 })
    await seedSynced(c, a, b) // the user's custom order: c, a, b (NOT updatedAt order)
    for (const g of [a, b, c]) fakeRemote.rows.set(g.id, remoteRow(g, 0)) // rows written before position was ever pushed

    await performSync(session)
    expect((await getGroupsState()).available.map((g) => g.id).slice(1)).toEqual(['c', 'a', 'b'])

    await performSync(session) // the next cycle pushes the (now flagged) positions
    expect(['c', 'a', 'b'].map((id) => fakeRemote.rows.get(id)?.position)).toEqual([1, 2, 3])
    expect((await getGroupsState()).available.map((g) => g.id).slice(1)).toEqual(['c', 'a', 'b'])
  })

  it('treats a null position as unknown too', async () => {
    await seedSynced(synced('b'), synced('a'))
    fakeRemote.rows.set('a', { ...remoteRow(synced('a')), position: null })
    fakeRemote.rows.set('b', { ...remoteRow(synced('b')), position: null })
    await performSync(session)
    expect((await getGroupsState()).available.map((g) => g.id).slice(1)).toEqual(['b', 'a'])
  })
})

describe('realtime guards (M2 + INSERT)', () => {
  const rtRow = (g: Group, position?: number) => remoteRow(g, position)

  it('M2: a realtime UPDATE never replaces a local copy with an unpushed change, even if it looks newer', async () => {
    await seedSynced(synced('g1', { name: 'Mine' }))
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: s.available.map((g) => (g.id === 'g1' ? { ...g, name: 'Unpushed edit', updatedAt: 2000, pendingSync: true } : g)) })
    await subscribeToRemoteChanges(session, () => {})
    await fakeRemote.realtimeCb!({ eventType: 'UPDATE', new: rtRow(synced('g1', { name: 'Server echo', updatedAt: 9000 })) })
    const after = (await getGroupsState()).available.find((g) => g.id === 'g1')
    expect(after?.name).toBe('Unpushed edit')
    expect(after?.pendingSync).toBe(true)
  })

  it('INSERT: a group created on another device is not flagged positionDirty (its author position stands)', async () => {
    await seedSynced(synced('a'))
    await subscribeToRemoteChanges(session, () => {})
    await fakeRemote.realtimeCb!({ eventType: 'INSERT', new: rtRow(synced('new1'), 1) })
    const f = await flags()
    expect(f.new1).toEqual({ p: false, d: false })
    expect(f.a.d).toBe(false)
  })
})

describe('M3 undo history is cleared when foreign changes are applied', () => {
  it('fires for a pull that applies a remote change, not for a no-op pull, and for an applied realtime update', async () => {
    const seen = vi.fn()
    const off = onForeignGroupsChange(seen)
    await seedSynced(synced('a'))
    await performSync(session) // nothing to apply
    expect(seen).not.toHaveBeenCalled()

    fakeRemote.rows.set('a', { ...remoteRow(synced('a', { name: 'Edited elsewhere', updatedAt: 5000 }), 1) })
    await performSync(session)
    expect(seen).toHaveBeenCalledTimes(1)

    await subscribeToRemoteChanges(session, () => {})
    await fakeRemote.realtimeCb!({ eventType: 'UPDATE', new: remoteRow(synced('a', { name: 'Again', updatedAt: 6000 }), 1) })
    expect(seen).toHaveBeenCalledTimes(2)
    off()
  })
})

describe('M5 index-addressed mutators keep the fresh order and give feedback', () => {
  const clientWrapper = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return { qc, w: ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children) }
  }

  it('a rename applied after a sync reorder does NOT write the stale base order back', async () => {
    await seedSynced(synced('a'), synced('b'), synced('c'))
    const { w } = clientWrapper()
    const { result: groups } = renderHook(() => useGroups(), { wrapper: w })
    await waitFor(() => expect(groups.current.isSuccess).toBe(true))
    await reorder(['c', 'a', 'b']) // a pulled reorder; cache still shows a, b, c

    const { result: rename } = renderHook(() => useUpdateGroupName(), { wrapper: w })
    await rename.current.mutateAsync({ groupIndex: 1, name: 'Renamed' })

    const after = (await getGroupsState()).available
    expect(after.map((g) => g.id).slice(1)).toEqual(['c', 'a', 'b']) // the fresh order survives
    expect(after.find((g) => g.id === 'a')?.name).toBe('Renamed')
  })

  it('a mutation whose target is gone shows a toast and does not count as a success', async () => {
    await seedSynced(synced('a'), synced('b'))
    const { w } = clientWrapper()
    const { result: groups } = renderHook(() => useGroups(), { wrapper: w })
    await waitFor(() => expect(groups.current.isSuccess).toBe(true))
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: s.available.filter((g) => g.id !== 'b') }) // deleted elsewhere

    vi.mocked(trackEvent).mockClear()
    const { result: rename } = renderHook(() => useUpdateGroupName(), { wrapper: w })
    await rename.current.mutateAsync({ groupIndex: 2, name: 'Ghost' })

    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/changed/i), expect.objectContaining({ id: 'groups-changed-elsewhere' }))
    expect(trackEvent).not.toHaveBeenCalledWith('group_renamed')
    expect((await getGroupsState()).available.map((g) => g.name)).not.toContain('Ghost')
  })
})
