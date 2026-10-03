import { describe, it, expect } from 'vitest'
import { CONFLICT_COPY_SUFFIX } from '@tabmerger/shared'
import { groupContentEqual, conflictCopyName, makeConflictCopy } from '@/lib/syncConflict'
import type { Group } from '@/lib/types'

const g = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Work', color: '#fff', updatedAt: 1, starred: false, archived: false, info: '2 tabs',
  windows: [{ id: 1, incognito: false, focused: false, tabs: [{ id: 0, title: 'A', url: 'https://a.com' }] }],
  ...over
})

describe('groupContentEqual', () => {
  it('ignores sync bookkeeping and key order, and treats missing note/info/flags as empty', () => {
    const a = g({ pendingSync: true, updatedAt: 99, remoteUpdatedAt: 's1', positionDirty: true })
    const b = g({ updatedAt: 5, remoteUpdatedAt: 's2' })
    expect(groupContentEqual(a, b)).toBe(true)
    const reordered = { ...g(), windows: [{ tabs: [{ url: 'https://a.com', title: 'A', id: 0 }], focused: false, incognito: false, id: 1 }] }
    expect(groupContentEqual(g(), reordered as Group)).toBe(true)
    expect(groupContentEqual(g({ note: undefined }), g({ note: '' }))).toBe(true)
  })

  it('detects real content differences (name, tabs, color, starred, archived, note, info)', () => {
    expect(groupContentEqual(g(), g({ name: 'Other' }))).toBe(false)
    expect(groupContentEqual(g(), g({ color: '#000' }))).toBe(false)
    expect(groupContentEqual(g(), g({ starred: true }))).toBe(false)
    expect(groupContentEqual(g(), g({ note: 'hi' }))).toBe(false)
    expect(groupContentEqual(g(), g({ windows: [] }))).toBe(false)
  })
})

describe('conflict copies', () => {
  it('suffixes the name once (no stacking) using the shared constant', () => {
    expect(conflictCopyName('Work')).toBe(`Work${CONFLICT_COPY_SUFFIX}`)
    expect(conflictCopyName(`Work${CONFLICT_COPY_SUFFIX}`)).toBe(`Work${CONFLICT_COPY_SUFFIX}`)
    expect(CONFLICT_COPY_SUFFIX).toBe(' (conflict copy)')
  })

  it('makeConflictCopy keeps this device content as a NEW pending group with no server base', () => {
    const local = g({ remoteUpdatedAt: 's1', positionDirty: true, pendingSync: false, updatedAt: 1 })
    const copy = makeConflictCopy(local)
    expect(copy.id).not.toBe(local.id)
    expect(copy.name).toBe('Work (conflict copy)')
    expect(copy.windows).toEqual(local.windows)
    expect(copy.pendingSync).toBe(true)
    expect(copy.remoteUpdatedAt).toBeUndefined()
    expect(copy.positionDirty).toBeUndefined()
    expect(copy.updatedAt).toBeGreaterThan(1)
  })
})
