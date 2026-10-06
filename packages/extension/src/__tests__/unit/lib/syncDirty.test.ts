import { describe, it, expect } from 'vitest'
import { restoreSnapshotAsLocalChange } from '@/lib/syncDirty'
import type { Group, GroupsState } from '@/lib/types'

const g = (id: string, over: Partial<Group> = {}): Group =>
  ({ id, name: id, color: '#fff', updatedAt: 1000, windows: [], permanent: false, starred: false, pendingSync: false, ...over })
const state = (...groups: Group[]): GroupsState => ({ active: { id: groups[0].id, index: 0 }, available: groups })

describe('restoreSnapshotAsLocalChange', () => {
  it('stamps a fresh updatedAt and pendingSync on a group whose content differs from the current one', () => {
    const current = state(g('now', { permanent: true }), g('a', { name: 'B', updatedAt: 2000 }))
    const snapshot = state(g('now', { permanent: true }), g('a', { name: 'A', updatedAt: 1000 }))
    const out = restoreSnapshotAsLocalChange(current, snapshot)
    expect(out.available[1].name).toBe('A')
    expect(out.available[1].pendingSync).toBe(true)
    expect(out.available[1].updatedAt).toBeGreaterThan(2000)
  })

  it('treats a group missing from the current state (undone delete) as a new local change', () => {
    const current = state(g('now', { permanent: true }))
    const snapshot = state(g('now', { permanent: true }), g('a'))
    expect(restoreSnapshotAsLocalChange(current, snapshot).available[1].pendingSync).toBe(true)
  })

  it('keeps the sync state of groups with identical content and never touches Now Open', () => {
    const now = g('now', { permanent: true })
    const current = state(now, g('a', { updatedAt: 7, pendingSync: true }))
    const snapshot = state(now, g('a', { updatedAt: 1, pendingSync: false }))
    const out = restoreSnapshotAsLocalChange(current, snapshot)
    expect(out.available[0]).toBe(now)
    expect(out.available[1]).toMatchObject({ updatedAt: 7, pendingSync: true })
  })

  it('keeps the CURRENT Now Open (live tabs), never the snapshot stale copy', () => {
    const liveNow = g('now', { permanent: true, windows: [{ id: 1, tabs: [], incognito: false, focused: false }] })
    const staleNow = g('now', { permanent: true })
    const out = restoreSnapshotAsLocalChange(state(liveNow, g('a')), state(staleNow, g('a')))
    expect(out.available[0]).toBe(liveNow)
  })

  it('does not mark a group that only moved: the write derives positionDirty from the order', () => {
    const a = g('a'), b = g('b')
    const out = restoreSnapshotAsLocalChange(state(g('now', { permanent: true }), a, b), state(g('now', { permanent: true }), b, a))
    expect(out.available.slice(1).every((x) => !x.pendingSync && !x.positionDirty)).toBe(true)
  })
})

import { asNewGroup, prepareImportedState } from '@/lib/syncDirty'

describe('new identities carry no sync bookkeeping (F1)', () => {
  const synced = (id: string) => g(id, { remoteUpdatedAt: '2030-01-01T00:00:00Z', positionDirty: true, pendingSync: false })

  it('asNewGroup: new id, no server base, no position flag, pending', () => {
    const copy = asNewGroup(synced('a'), 'fresh')
    expect(copy).toMatchObject({ id: 'fresh', pendingSync: true })
    expect(copy.remoteUpdatedAt).toBeUndefined()
    expect(copy.positionDirty).toBeUndefined()
    expect(copy.name).toBe('a')
  })

  it('undo of a delete strips the OLD base so the restored group re-inserts', () => {
    const now = g('now', { permanent: true })
    const out = restoreSnapshotAsLocalChange(state(now), state(now, synced('gone')))
    expect(out.available[1].remoteUpdatedAt).toBeUndefined()
    expect(out.available[1].positionDirty).toBeUndefined()
    expect(out.available[1]).toMatchObject({ id: 'gone', pendingSync: true })
  })

  it('JSON import: fresh ids, no bookkeeping, current Now Open kept first, active remapped', () => {
    const liveNow = g('now', { permanent: true, windows: [{ id: 1, tabs: [], incognito: false, focused: false }] })
    const file: GroupsState = { active: { id: 'a', index: 1 }, available: [g('now', { permanent: true }), synced('a'), synced('b')], rev: 99 }
    const out = prepareImportedState(file, { ...state(liveNow), rev: 7 })
    expect(out.available[0]).toBe(liveNow)
    const saved = out.available.slice(1)
    expect(saved.map((x) => x.name)).toEqual(['a', 'b'])
    expect(saved.every((x) => x.id !== 'a' && x.id !== 'b' && !x.remoteUpdatedAt && !x.positionDirty && x.pendingSync)).toBe(true)
    expect(out.active.id).toBe(saved[0].id)
    expect(out.rev).toBe(7) // the cache rev, not the file's
  })
})
