import { describe, it, expect } from 'vitest'
import { LOCAL_ONLY_STRIP_MAX_DEPTH, LOCAL_ONLY_SYNC_KEYS, withoutLocalOnlySyncKeys } from '../constants/localOnlySyncKeys'

describe('LOCAL_ONLY_SYNC_KEYS', () => {
  it('lists exactly this device\'s sync bookkeeping', () => {
    expect([...LOCAL_ONLY_SYNC_KEYS].sort()).toEqual(['pendingSync', 'positionDirty', 'remoteUpdatedAt'])
  })
})

describe('withoutLocalOnlySyncKeys', () => {
  const tab = { id: 0, title: 't', url: 'https://a.com', pendingSync: true, remoteUpdatedAt: 4 }
  const win = { id: 1, tabs: [tab], positionDirty: true }
  const group = { id: 'g', name: 'G', windows: [win], pendingSync: false, positionDirty: true, remoteUpdatedAt: 9 }

  it('removes the keys at the group, window and tab level and keeps everything else', () => {
    expect(withoutLocalOnlySyncKeys([group])).toEqual([{ id: 'g', name: 'G', windows: [{ id: 1, tabs: [{ id: 0, title: 't', url: 'https://a.com' }] }] }])
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify([group])
    withoutLocalOnlySyncKeys([group])
    expect(JSON.stringify([group])).toBe(before)
  })

  it('removes a key even when its value is false, 0, null or undefined', () => {
    const out = withoutLocalOnlySyncKeys({ a: 1, pendingSync: false, positionDirty: 0, remoteUpdatedAt: null }) as Record<string, unknown>
    expect(Object.keys(out)).toEqual(['a'])
  })

  it('passes primitives and null through', () => {
    for (const v of [1, 'x', true, null, undefined]) expect(withoutLocalOnlySyncKeys(v)).toBe(v)
  })

  it('keeps similarly named keys', () => {
    expect(withoutLocalOnlySyncKeys({ pendingSyncs: 1, remoteUpdatedAtX: 2 })).toEqual({ pendingSyncs: 1, remoteUpdatedAtX: 2 })
  })

  it('at the depth bound the walk stops: content nested deeper is left out (empty object or array)', () => {
    let deep: unknown = { pendingSync: true, keep: 1 }
    for (let i = 0; i < LOCAL_ONLY_STRIP_MAX_DEPTH + 2; i++) deep = { child: deep }
    let node = withoutLocalOnlySyncKeys(deep) as Record<string, unknown>
    let levels = 0
    while (Object.keys(node).length > 0 && levels < 50) {
      node = node.child as Record<string, unknown>
      levels++
    }
    expect(levels).toBe(LOCAL_ONLY_STRIP_MAX_DEPTH)
    expect(node).toEqual({})
  })

  it('one level inside the bound is still stripped', () => {
    let inner: unknown = { pendingSync: true, keep: 1 }
    for (let i = 0; i < LOCAL_ONLY_STRIP_MAX_DEPTH - 1; i++) inner = { child: inner }
    let node = withoutLocalOnlySyncKeys(inner) as Record<string, unknown>
    for (let i = 0; i < LOCAL_ONLY_STRIP_MAX_DEPTH - 1; i++) node = node.child as Record<string, unknown>
    expect(node).toEqual({ keep: 1 })
  })

  it('an array nested past the bound becomes an empty array', () => {
    let deep: unknown = [{ pendingSync: true }]
    for (let i = 0; i < LOCAL_ONLY_STRIP_MAX_DEPTH; i++) deep = { child: deep }
    let node = withoutLocalOnlySyncKeys(deep) as Record<string, unknown>
    for (let i = 0; i < LOCAL_ONLY_STRIP_MAX_DEPTH - 1; i++) node = node.child as Record<string, unknown>
    expect(node.child).toEqual([])
  })
})
