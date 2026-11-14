import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDB, deleteDB, type IDBPDatabase } from 'idb'

// Real IndexedDB (fake-indexeddb): how localDb opens, shares and gives up its ONE connection.
// Every test loads a fresh copy of localDb on an empty database.

type LocalDb = typeof import('@/lib/localDb')
let local: LocalDb
const extra: IDBPDatabase[] = []

async function freshLocalDb(): Promise<LocalDb> {
  vi.resetModules()
  return import('@/lib/localDb')
}

/** A version-1 database as the released v1 build created it. */
async function createV1(): Promise<IDBPDatabase> {
  return openDB('tabmerger', 1, {
    upgrade(db) {
      db.createObjectStore('groups', { keyPath: 'id' }).createIndex('by-updatedAt', 'updatedAt')
      db.createObjectStore('groupsState', { keyPath: 'id' })
      db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('by-createdAt', 'createdAt')
      db.createObjectStore('settings', { keyPath: 'id' })
    },
  })
}

beforeEach(async () => {
  await deleteDB('tabmerger')
  local = await freshLocalDb()
})

afterEach(async () => {
  for (const db of extra.splice(0)) db.close()
  try {
    ;(await local.getDb()).close()
  } catch {
    // never opened
  }
  vi.restoreAllMocks()
})

describe('getDb connection', () => {
  it('concurrent first calls share ONE connection', async () => {
    const [a, b, c] = await Promise.all([local.getDb(), local.getDb(), local.getDb()])
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(a.version).toBe(local.DB_VERSION)
  })

  it('an older connection that closes on versionchange lets the upgrade through (and is forgotten)', async () => {
    const v1 = await createV1()
    await v1.put('settings', { id: 'appSettings', value: { theme: 'dark' } })
    let closedByVersionChange = false
    v1.addEventListener('versionchange', () => {
      closedByVersionChange = true
      v1.close()
    })
    const db = await local.getDb()
    expect(closedByVersionChange).toBe(true)
    expect(db.version).toBe(2)
    expect(await db.get('settings', 'appSettings')).toEqual({ id: 'appSettings', value: { theme: 'dark' } })
  })

  it('an older connection that stays open blocks the upgrade (logged) until it closes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const v1 = await createV1()
    const opening = local.getDb()
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('waiting for an older connection')))
    v1.close()
    expect((await opening).version).toBe(2)
  })

  it('this context closes and forgets its connection when a newer version opens, then reopens', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ours = await local.getDb()
    // a newer build (version 3) opens the same database: ours must step aside
    const newer = await openDB('tabmerger', 3)
    extra.push(newer)
    expect(newer.version).toBe(3)
    // the next getDb opens a NEW connection; the database is now newer than this build (VersionError):
    // it is opened as is instead of failing, so the data stays readable
    const reopened = await local.getDb()
    expect(reopened).not.toBe(ours)
    expect(reopened.version).toBe(3)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('newer than this build'), expect.anything())
    expect([...reopened.objectStoreNames]).toContain('groups')
    reopened.close()
  })

  it('a database newer than this build (a downgraded build) is still readable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const v3 = await openDB('tabmerger', 3, {
      upgrade(db) {
        db.createObjectStore('groups', { keyPath: 'id' }).createIndex('by-updatedAt', 'updatedAt')
        db.createObjectStore('groupsState', { keyPath: 'id' })
        db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('by-createdAt', 'createdAt')
        db.createObjectStore('settings', { keyPath: 'id' })
        db.createObjectStore('recentlyClosed', { keyPath: 'id' }).createIndex('closedAt', 'closedAt')
      },
    })
    await v3.put('groups', { id: 'g1', name: 'Kept', color: 'rgba(1, 2, 3, 1)', updatedAt: 1, windows: [] })
    v3.close()
    const db = await local.getDb()
    expect(db.version).toBe(3)
    expect(await db.get('groups', 'g1')).toMatchObject({ name: 'Kept' })
    expect(error).toHaveBeenCalled()
  })

  it('a failed open is not memoised: the next call tries again', async () => {
    const open = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      throw new Error('storage unavailable')
    })
    await expect(local.getDb()).rejects.toThrow('storage unavailable')
    open.mockRestore()
    expect((await local.getDb()).version).toBe(2)
  })
})
