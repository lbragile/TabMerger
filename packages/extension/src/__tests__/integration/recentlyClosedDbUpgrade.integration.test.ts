import { describe, expect, it } from 'vitest'
import { openDB } from 'idb'

// Real IndexedDB (fake-indexeddb). This file creates a version-1 database BEFORE localDb ever opens
// it (localDb is imported dynamically below), so the v1 -> v2 upgrade really runs.

describe('IndexedDB v1 -> v2 upgrade (recentlyClosed store)', () => {
  it('adds the recentlyClosed store and keeps every existing group, session and setting', async () => {
    const v1 = await openDB('tabmerger', 1, {
      upgrade(db) {
        db.createObjectStore('groups', { keyPath: 'id' }).createIndex('by-updatedAt', 'updatedAt')
        db.createObjectStore('groupsState', { keyPath: 'id' })
        db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('by-createdAt', 'createdAt')
        db.createObjectStore('settings', { keyPath: 'id' })
      },
    })
    const group = { id: 'g1', name: 'Work', color: 'rgba(1, 2, 3, 1)', updatedAt: 5, windows: [] }
    await v1.put('groups', group)
    await v1.put('groupsState', { id: 'state', active: { id: 'g1', index: 0 }, order: ['g1'], rev: 3 })
    await v1.put('sessions', { id: 's1', name: 'S', createdAt: 9, groups: [] })
    await v1.put('settings', { id: 'appSettings', value: { theme: 'dark' } })
    v1.close()

    const { getDb, getSetting } = await import('@/lib/localDb')
    const { addRecentlyClosedEntry, getRecentlyClosedEntries } = await import('@/lib/recentlyClosedDb')
    const db = await getDb()
    expect(db.version).toBe(2)
    expect([...db.objectStoreNames].sort()).toEqual(['groups', 'groupsState', 'recentlyClosed', 'sessions', 'settings'])
    expect(db.transaction('recentlyClosed').store.indexNames.contains('closedAt')).toBe(true)
    expect(await db.get('groups', 'g1')).toEqual(group)
    expect(await db.get('groupsState', 'state')).toMatchObject({ order: ['g1'], rev: 3 })
    expect(await db.get('sessions', 's1')).toMatchObject({ name: 'S' })
    // an existing user's settings lack the new switch: it reads as on, and recording works
    expect(await getSetting('appSettings', {})).toEqual({ theme: 'dark' })
    await addRecentlyClosedEntry({ id: 'e1', closedAt: 1, kind: 'tab', tabs: [{ url: 'https://a.test', title: 'A' }] }, { entries: 10, days: 100000 }, 2)
    expect((await getRecentlyClosedEntries()).map((e) => e.id)).toEqual(['e1'])
  })
})
