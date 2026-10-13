import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { encryptBlob, generateDataKey, withoutLocalOnlySyncKeys, DEFAULT_BACKUP_FILE_FOLDER } from '@tabmerger/shared'
import { downloadAutoBackups } from '@/lib/autoBackupDownload'
import { backupFileContent } from '@/lib/autoBackupFile'
import { importGroups } from '@/lib/importExport'
import { useReplaceSavedGroups } from '@/hooks/useGroups'
import { useUIStore } from '@/stores/uiStore'
import {
  clearAllLocalData,
  clearLocalAccountData,
  commitSessions,
  commitSessionsIfGuardHolds,
  compareAndSetSetting,
  deleteSession,
  getGroupsState,
  getPendingGroupDeletes,
  getSessions,
  getSetting,
  markSessionUploaded,
  saveGroupsState,
  saveSession,
  setSetting,
} from '@/lib/localDb'
import {
  APP_SETTINGS_KEY,
  AUTO_BACKUP_FILE_LAST_KEY,
  AUTO_BACKUP_FILE_STATUS_KEY,
  AUTO_BACKUP_PENDING_DELETES_KEY,
  AUTO_BACKUP_STORE_GUARD_KEY,
  CLOUD_SYNC_ACTIVE_KEY,
  LAST_USER_ID_KEY,
} from '@/lib/syncSettingKeys'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import type { Group, Session } from '@/lib/types'
import { clearDb } from './dbTestUtils'

// Real IndexedDB (fake-indexeddb). Only the network edge is faked.

const net = vi.hoisted(() => ({
  userId: 'user-1' as string | null,
  key: null as CryptoKey | null,
  rows: new Map<string, { id: string; user_id: string; name: string; description: unknown; groups: unknown; created_at: string }>(),
  groupDeletes: [] as string[][],
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: net.userId ? { user: { id: net.userId } } : null } }) },
    from(table: string) {
      if (table === 'groups') {
        // the remote delete never gets confirmed here: the ids must stay pending
        return {
          delete: () => ({
            in: (_c: string, ids: string[]) => ({
              eq: () => ({
                abortSignal: async () => {
                  net.groupDeletes.push(ids)
                  return { error: { message: 'offline' } }
                },
              }),
            }),
          }),
        }
      }
      return {
        select: () => {
          const b = {
            eq: () => b,
            order: () => b,
            limit: () => ({
              abortSignal: async () => ({ data: [...net.rows.values()].sort((a, c) => (a.created_at < c.created_at ? 1 : -1)), error: null }),
            }),
          }
          return b
        },
        delete: () => ({ in: () => ({ eq: () => ({ abortSignal: async () => ({ error: null }) }) }) }),
      }
    },
  },
  isSupabaseConfigured: true,
}))
vi.mock('@/lib/contentUploadKey', () => ({
  getContentUploadKey: async () => (net.key ? { key: net.key } : { key: null, reason: 'locked' }),
  UPLOAD_BLOCKED_MESSAGE: { 'no-key': 'a', unknown: 'b', locked: 'c' },
}))
vi.mock('@/lib/syncEngine', async (orig) => ({ ...(await orig<typeof import('@/lib/syncEngine')>()), canUploadOnFirefox: async () => true }))

const DAY = 86_400_000

const savedGroup = (id: string, extra: Record<string, unknown> = {}): Group => ({
  ...createGroup(id, `Group ${id}`),
  windows: [
    { id: 1, name: `W ${id}`, incognito: false, focused: false, tabs: [{ id: 0, title: `T ${id}`, url: `https://example.com/${id}/1` }, { id: 0, title: `U ${id}`, url: `https://example.com/${id}/2` }] },
    { id: 2, incognito: false, focused: false, tabs: [{ id: 0, title: `V ${id}`, url: `https://example.com/${id}/3` }] },
  ],
  ...extra,
})
const backup = (id: string, createdAt: number, extra: Partial<Session> = {}): Session => ({ id, name: id, groups: [savedGroup('z')], createdAt, auto: true, ...extra })

beforeEach(async () => {
  await clearDb()
  net.userId = 'user-1'
  net.key = await generateDataKey()
  net.rows.clear()
  net.groupDeletes.length = 0
  useUIStore.setState({ undoStack: [], redoStack: [] })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('commitSessions / commitSessionsIfGuardHolds: updateSettings is atomic', () => {
  const append = (id: string) => (stored: unknown) => [...((stored as string[] | undefined) ?? []), id]

  it('many overlapping unguarded writers each add their id: none is lost', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `id${i}`)
    await Promise.all(ids.map((id) => commitSessions({ updateSettings: { [AUTO_BACKUP_PENDING_DELETES_KEY]: append(id) } })))
    const stored = await getSetting<string[]>(AUTO_BACKUP_PENDING_DELETES_KEY, [])
    expect([...stored].sort()).toEqual([...ids].sort())
  })

  it('a guarded writer and an unguarded writer overlap: both ids survive', async () => {
    await setSetting(AUTO_BACKUP_STORE_GUARD_KEY, 'user-1')
    await Promise.all([
      commitSessionsIfGuardHolds({ key: AUTO_BACKUP_STORE_GUARD_KEY, value: 'user-1' }, { updateSettings: { [AUTO_BACKUP_PENDING_DELETES_KEY]: append('from-worker') } }),
      commitSessions({ deleteSessionIds: ['x'], updateSettings: { [AUTO_BACKUP_PENDING_DELETES_KEY]: append('from-popup') } }),
    ])
    expect((await getSetting<string[]>(AUTO_BACKUP_PENDING_DELETES_KEY, [])).sort()).toEqual(['from-popup', 'from-worker'])
  })

  it('the update function sees undefined when nothing is stored yet', async () => {
    const seen: unknown[] = []
    await commitSessions({ updateSettings: { k: (stored) => (seen.push(stored), 1) } })
    expect(seen).toEqual([undefined])
    expect(await getSetting('k', 0)).toBe(1)
  })

  it('the local delete and the pending id land together (one transaction), or neither does', async () => {
    await saveSession(backup('b1', 1))
    await commitSessions({ deleteSessionIds: ['b1'], updateSettings: { [AUTO_BACKUP_PENDING_DELETES_KEY]: append('b1') } })
    expect(await getSessions()).toEqual([])
    expect(await getSetting(AUTO_BACKUP_PENDING_DELETES_KEY, [])).toEqual(['b1'])
  })

  it('a guard that does not hold writes nothing at all (sessions, settings and updates)', async () => {
    await saveSession(backup('b1', 1))
    await setSetting(AUTO_BACKUP_STORE_GUARD_KEY, 'user-2')
    const ok = await commitSessionsIfGuardHolds(
      { key: AUTO_BACKUP_STORE_GUARD_KEY, value: 'user-1' },
      { putSessions: [backup('b2', 2)], deleteSessionIds: ['b1'], settings: { s: 1 }, updateSettings: { u: () => 2 } }
    )
    expect(ok).toBe(false)
    expect((await getSessions()).map((s) => s.id)).toEqual(['b1'])
    expect(await getSetting('s', null)).toBeNull()
    expect(await getSetting('u', null)).toBeNull()
  })

  it('a missing guard (wiped store) also writes nothing', async () => {
    expect(await commitSessionsIfGuardHolds({ key: AUTO_BACKUP_STORE_GUARD_KEY, value: 'user-1' }, { putSessions: [backup('b2', 2)] })).toBe(false)
    expect(await getSessions()).toEqual([])
  })
})

describe('compareAndSetSetting', () => {
  it('writes only when the stored value is exactly the expected one', async () => {
    await setSetting('flag', 0)
    expect(await compareAndSetSetting('flag', 0, true)).toBe(true)
    expect(await getSetting('flag', null)).toBe(true)
    expect(await compareAndSetSetting('flag', 0, 'again')).toBe(false)
    expect(await getSetting('flag', null)).toBe(true)
  })

  it('is strict: 0 is not false, and a missing key never matches', async () => {
    await setSetting('flag', false)
    expect(await compareAndSetSetting('flag', 0, true)).toBe(false)
    expect(await compareAndSetSetting('missing', undefined, true)).toBe(false)
    expect(await getSetting('missing', 'none')).toBe('none')
  })

  it('a re-arm written while a pass runs survives the pass finishing', async () => {
    await setSetting('flag', 0) // pass starts: in-progress marker
    await setSetting('flag', false) // a save re-arms during the pass
    expect(await compareAndSetSetting('flag', 0, true)).toBe(false) // the pass cannot mark it done
    expect(await getSetting('flag', null)).toBe(false)
  })

  it('two racing finishers: exactly one wins', async () => {
    await setSetting('flag', 0)
    const results = await Promise.all([compareAndSetSetting('flag', 0, 'a'), compareAndSetSetting('flag', 0, 'b')])
    expect(results.filter(Boolean)).toHaveLength(1)
  })
})

describe('markSessionUploaded', () => {
  it('stamps uploadedAt on a stored session and keeps everything else', async () => {
    await saveSession(backup('b1', 5, { name: 'keep me' }))
    await markSessionUploaded('b1', 99)
    expect(await getSessions()).toEqual([expect.objectContaining({ id: 'b1', name: 'keep me', uploadedAt: 99, auto: true })])
  })

  it('a session deleted meanwhile is NOT re-created', async () => {
    await markSessionUploaded('gone', 99)
    expect(await getSessions()).toEqual([])
  })

  it('delete racing the stamp: the session is gone whichever runs first', async () => {
    await saveSession(backup('b1', 5))
    await Promise.all([deleteSession('b1'), markSessionUploaded('b1', 99)])
    expect(await getSessions()).toEqual([])
  })

  it('the markUploaded form of a commit also skips a session that is gone', async () => {
    await saveSession(backup('b1', 5))
    await commitSessions({ deleteSessionIds: ['b1'] })
    await commitSessions({ markUploaded: { ids: ['b1'], at: 1 } })
    expect(await getSessions()).toEqual([])
  })
})

describe('account and "Clear all data" wipes', () => {
  it('clearAllLocalData removes a setting written just before it, but keeps the owner and the sync flag', async () => {
    await setSetting(LAST_USER_ID_KEY, 'user-1')
    await setSetting(CLOUD_SYNC_ACTIVE_KEY, true)
    await saveSession(backup('b1', 1))
    await setSetting(AUTO_BACKUP_PENDING_DELETES_KEY, ['p1'])
    // the guard write lands between the call and the wipe's own transaction: the keys are listed INSIDE it
    await Promise.all([clearAllLocalData(), setSetting(AUTO_BACKUP_STORE_GUARD_KEY, 'user-1')])
    expect(await getSetting(AUTO_BACKUP_STORE_GUARD_KEY, null)).toBeNull()
    expect(await getSetting(AUTO_BACKUP_PENDING_DELETES_KEY, null)).toBeNull()
    expect(await getSessions()).toEqual([])
    expect(await getSetting(LAST_USER_ID_KEY, null)).toBe('user-1')
    expect(await getSetting(CLOUD_SYNC_ACTIVE_KEY, null)).toBe(true)
  })

  it('clearLocalAccountData switches the file copy OFF but keeps the folder, the pattern and the other preferences', async () => {
    await setSetting(APP_SETTINGS_KEY, { theme: 'dark', autoBackupEnabled: true, autoBackupFileEnabled: true, autoBackupFileFolder: 'My/Backups', autoBackupFilePattern: 'bk {date}' })
    await clearLocalAccountData()
    expect(await getSetting(APP_SETTINGS_KEY, null)).toMatchObject({
      theme: 'dark',
      autoBackupEnabled: true,
      autoBackupFileEnabled: false,
      autoBackupFileFolder: 'My/Backups',
      autoBackupFilePattern: 'bk {date}',
    })
  })

  it('clearLocalAccountData creates no settings object when there was none, and leaves a file copy that was already off alone', async () => {
    await clearLocalAccountData()
    expect(await getSetting(APP_SETTINGS_KEY, null)).toBeNull()
    await setSetting(APP_SETTINGS_KEY, { theme: 'light' })
    await clearLocalAccountData()
    expect(await getSetting(APP_SETTINGS_KEY, null)).toEqual({ theme: 'light' })
  })

  it('a malformed stored settings value does not break the wipe', async () => {
    await setSetting(APP_SETTINGS_KEY, 'garbage')
    await expect(clearLocalAccountData()).resolves.toBeUndefined()
    await setSetting(APP_SETTINGS_KEY, ['x'])
    await expect(clearLocalAccountData()).resolves.toBeUndefined()
  })

  it('clearLocalAccountData removes the last backup file record and its status (a download id belongs to one account on one profile)', async () => {
    await setSetting(AUTO_BACKUP_FILE_LAST_KEY, { id: 12, at: 1000 })
    await setSetting(AUTO_BACKUP_FILE_STATUS_KEY, { at: 1000, result: 'saved', path: 'TabMerger/b.json' })
    await clearLocalAccountData()
    expect(await getSetting(AUTO_BACKUP_FILE_LAST_KEY, null)).toBeNull()
    expect(await getSetting(AUTO_BACKUP_FILE_STATUS_KEY, null)).toBeNull()
  })

  it('clearAllLocalData removes the last backup file record too', async () => {
    await setSetting(AUTO_BACKUP_FILE_LAST_KEY, { id: 12, at: 1000 })
    await clearAllLocalData()
    expect(await getSetting(AUTO_BACKUP_FILE_LAST_KEY, null)).toBeNull()
  })

  it('the last backup file record survives a commit that does not touch it, and a failed guard commit does not write it', async () => {
    await setSetting(AUTO_BACKUP_FILE_LAST_KEY, { id: 12, at: 1000 })
    await setSetting(AUTO_BACKUP_STORE_GUARD_KEY, 'user-1')
    await commitSessionsIfGuardHolds({ key: AUTO_BACKUP_STORE_GUARD_KEY, value: 'user-2' }, { settings: { [AUTO_BACKUP_FILE_LAST_KEY]: { id: 99, at: 2000 } } })
    expect(await getSetting(AUTO_BACKUP_FILE_LAST_KEY, null)).toEqual({ id: 12, at: 1000 })
    await commitSessionsIfGuardHolds({ key: AUTO_BACKUP_STORE_GUARD_KEY, value: 'user-1' }, { settings: { [AUTO_BACKUP_FILE_LAST_KEY]: { id: 99, at: 2000 } } })
    expect(await getSetting(AUTO_BACKUP_FILE_LAST_KEY, null)).toEqual({ id: 99, at: 2000 })
  })

  it('the wipe also removes backups, so the next account starts without the previous one', async () => {
    await saveSession(backup('b1', 1))
    await setSetting(AUTO_BACKUP_STORE_GUARD_KEY, 'user-1')
    await clearLocalAccountData()
    expect(await getSessions()).toEqual([])
    expect(await getSetting(AUTO_BACKUP_STORE_GUARD_KEY, null)).toBeNull()
    expect(DEFAULT_BACKUP_FILE_FOLDER).toBe('TabMerger')
  })
})

describe('download after the account lost the backup (web dashboard delete)', () => {
  it('keeps the local backup, with a complete, an empty and a full-page answer', async () => {
    await saveSession(backup('keep', Date.now() - DAY, { uploadedAt: 5 }))
    const out = await downloadAutoBackups()
    expect(out).toMatchObject({ status: 'done', added: 0, removed: 0 })
    expect((await getSessions()).map((s) => s.id)).toEqual(['keep'])

    // a full page of unrelated rows (a truncated answer)
    const { iv, ct } = await encryptBlob(net.key!, { name: 'manual', groups: [savedGroup('x')] })
    for (let i = 0; i < 100; i++) {
      net.rows.set(`other${i}`, { id: `other${i}`, user_id: 'user-1', name: '', description: null, groups: { v: 1, iv, ct }, created_at: new Date(Date.now() - 2 * DAY).toISOString() })
    }
    expect(await downloadAutoBackups()).toMatchObject({ status: 'done', removed: 0 })
    expect((await getSessions()).map((s) => s.id)).toEqual(['keep'])
  })

  it('a backup that is on the account is added, and the one the account lacks stays too', async () => {
    await saveSession(backup('local-only', Date.now() - 5 * DAY, { uploadedAt: 5 }))
    const { iv, ct } = await encryptBlob(net.key!, { name: 'remote', groups: [savedGroup('r')], auto: true })
    net.rows.set('remote1', { id: 'remote1', user_id: 'user-1', name: '', description: null, groups: { v: 1, iv, ct }, created_at: new Date(Date.now() - DAY).toISOString() })
    expect(await downloadAutoBackups()).toMatchObject({ status: 'done', added: 1, removed: 0 })
    expect((await getSessions()).map((s) => s.id).sort()).toEqual(['local-only', 'remote1'])
  })
})

describe('"Replace my groups" (useReplaceSavedGroups) — real IndexedDB', () => {
  function wrapper({ children }: { children: React.ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return React.createElement(QueryClientProvider, { client: qc }, children)
  }
  async function seed(...ids: string[]) {
    const nowOpen = createNowOpenGroup()
    await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, ...ids.map((i) => savedGroup(i))] })
    return nowOpen
  }

  it('with cloud sync NOT active the removed ids are still recorded for the remote delete, and Now Open is untouched', async () => {
    await setSetting(CLOUD_SYNC_ACTIVE_KEY, false)
    const nowOpen = await seed('a', 'b', 'c')
    const { result } = renderHook(() => useReplaceSavedGroups(), { wrapper })
    await result.current.mutateAsync([savedGroup('n1'), savedGroup('n2')])

    const state = await getGroupsState()
    expect(state.available[0].id).toBe(nowOpen.id)
    expect(state.available[0].permanent).toBe(true)
    const saved = state.available.filter((g) => !g.permanent)
    expect(saved.map((g) => g.name)).toEqual(['Group n1', 'Group n2'])
    // fresh ids, never the backup's own
    expect(saved.map((g) => g.id)).not.toContain('n1')

    await vi.waitFor(async () => expect((await getPendingGroupDeletes()).sort()).toEqual(['a', 'b', 'c']))
    await vi.waitFor(() => expect(net.groupDeletes.flat().sort()).toEqual(['a', 'b', 'c']))
    expect(await getPendingGroupDeletes()).not.toContain(nowOpen.id)
  })

  it('a replace with nothing to replace records no ids', async () => {
    await seed()
    const { result } = renderHook(() => useReplaceSavedGroups(), { wrapper })
    await result.current.mutateAsync([savedGroup('n1')])
    expect(await getPendingGroupDeletes()).toEqual([])
    expect(net.groupDeletes).toEqual([])
  })

  it('records one undo snapshot holding what the user had', async () => {
    await seed('a')
    const { result } = renderHook(() => useReplaceSavedGroups(), { wrapper })
    await result.current.mutateAsync([savedGroup('n1')])
    const stack = useUIStore.getState().undoStack
    expect(stack).toHaveLength(1)
    expect(stack[0].available.filter((g) => !g.permanent).map((g) => g.id)).toEqual(['a'])
  })

  it('signed out: nothing is recorded or sent (a signed-out user never pushed anything)', async () => {
    net.userId = null
    await seed('a')
    const { result } = renderHook(() => useReplaceSavedGroups(), { wrapper })
    await result.current.mutateAsync([savedGroup('n1')])
    expect(net.groupDeletes).toEqual([])
  })
})

describe('backup files import back through the real importGroups', () => {
  const stuffed = (id: string): Group => {
    const g = savedGroup(id, { pendingSync: true, positionDirty: true, remoteUpdatedAt: 7, note: 'a note' })
    for (const w of g.windows) {
      Object.assign(w, { pendingSync: true, remoteUpdatedAt: 1 })
      for (const t of w.tabs) Object.assign(t, { positionDirty: true, remoteUpdatedAt: 2 })
    }
    return g
  }
  const shape = (groups: Group[]) =>
    groups.map((g) => ({ name: g.name, note: g.note, windows: g.windows.map((w) => ({ name: w.name, tabs: w.tabs.map((t) => `${t.title}|${t.url}`) })) }))

  it("a file written by the extension: every group, window and tab comes back, with none of the device's sync bookkeeping", () => {
    const original = [stuffed('a'), stuffed('b'), stuffed('c')]
    const text = backupFileContent([createNowOpenGroup(), ...original])
    for (const k of ['pendingSync', 'positionDirty', 'remoteUpdatedAt']) expect(text).not.toContain(k)
    const { groups, skipped } = importGroups(text)
    expect(skipped).toBe(0)
    expect(groups).toHaveLength(3)
    expect(shape(groups)).toEqual(shape(original))
  })

  it('a file shaped like the web dashboard download (fields stripped at every level) imports the same way', () => {
    const original = [stuffed('a'), stuffed('b')]
    const webText = JSON.stringify(withoutLocalOnlySyncKeys(original), null, 2)
    expect(webText).not.toContain('remoteUpdatedAt')
    const { groups, skipped } = importGroups(webText)
    expect(skipped).toBe(0)
    expect(shape(groups)).toEqual(shape(original))
  })

  it('both writers produce the same file content for the same backup', () => {
    const original = [stuffed('a')]
    expect(JSON.parse(backupFileContent(original))).toEqual(JSON.parse(JSON.stringify(withoutLocalOnlySyncKeys(original))))
  })
})
