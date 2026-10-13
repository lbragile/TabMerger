import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { decryptBlob, encryptBlob, generateDataKey, isEncryptedBlob } from '@tabmerger/shared'
import { runAutoBackup, deleteAutoBackup, fingerprintGroups, isAutoBackup } from '@/lib/autoBackup'
import { downloadAutoBackups } from '@/lib/autoBackupDownload'
import { useImportGroups } from '@/hooks/useGroups'
import { useSync } from '@/hooks/useSync'
import {
  clearLocalAccountData,
  deleteSession,
  getGroupsState,
  getSessions,
  getSetting,
  saveGroupsState,
  saveSession,
  setSetting,
} from '@/lib/localDb'
import { AUTO_BACKUP_PENDING_DELETES_KEY, AUTO_BACKUP_STATE_KEY, LAST_USER_ID_KEY, SESSIONS_MIGRATION_DONE_KEY } from '@/lib/syncSettingKeys'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import type { Group, Session } from '@/lib/types'
import { clearDb } from './dbTestUtils'

// Real IndexedDB (fake-indexeddb). Only the network edge is faked: a small in-memory `sessions`
// table and `subscriptions` row, and the encryption key gate.

const net = vi.hoisted(() => ({
  userId: 'user-1' as string | null,
  tier: { tier: 'pro', status: 'active' } as { tier: string; status: string } | null,
  tierError: false,
  key: null as CryptoKey | null,
  rows: new Map<string, { id: string; user_id: string; name: string; description: unknown; groups: unknown; created_at: string }>(),
  upserts: [] as Array<Record<string, unknown>>,
  failUpsert: false,
  failDelete: false,
  deleted: [] as string[][],
  signals: [] as unknown[],
  /** runs inside a request, once: where a test lets something else happen while it is in flight */
  onSelect: null as null | (() => Promise<void>),
  onUpsert: null as null | ((id: string) => Promise<void>),
  authSession: { user: { id: 'user-1' } },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: net.userId ? { user: { id: net.userId } } : null } }) },
    from(table: string) {
      if (table === 'subscriptions') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => (net.tierError ? { data: null, error: { message: 'x' } } : { data: net.tier, error: null }) }) }),
        }
      }
      return {
        // every request in the product carries .abortSignal(): the fake requires it too
        upsert: (row: { id: string; user_id: string; name: string; description: unknown; groups: unknown; created_at: string }) => ({
          abortSignal: async (signal: unknown) => {
            net.signals.push(signal)
            net.upserts.push(row)
            const hook = net.onUpsert
            net.onUpsert = null
            await hook?.(row.id)
            if (net.failUpsert) return { error: { message: 'offline' } }
            net.rows.set(row.id, row)
            return { error: null }
          },
        }),
        delete: () => ({
          in: (_c: string, ids: string[]) => ({
            eq: () => ({
              abortSignal: async (signal: unknown) => {
                net.signals.push(signal)
                net.deleted.push(ids)
                if (net.failDelete) return { error: { message: 'offline' } }
                ids.forEach((id) => net.rows.delete(id))
                return { error: null }
              },
            }),
          }),
        }),
        select: () => {
          const b = {
            eq: () => b,
            order: () => b,
            limit: () => ({
              abortSignal: async (signal: unknown) => {
                net.signals.push(signal)
                const hook = net.onSelect
                net.onSelect = null
                await hook?.()
                return { data: [...net.rows.values()].sort((a, b2) => (a.created_at < b2.created_at ? 1 : -1)), error: null }
              },
            }),
          }
          return b
        },
      }
    },
  },
  isSupabaseConfigured: true,
}))
vi.mock('@/lib/contentUploadKey', () => ({
  getContentUploadKey: async () => (net.key ? { key: net.key } : { key: null, reason: 'locked' }),
  UPLOAD_BLOCKED_MESSAGE: { 'no-key': 'a', unknown: 'b', locked: 'c' },
}))
vi.mock('@/lib/syncEngine', () => ({
  canUploadOnFirefox: async () => true,
  // the groups cycle is not under test here: the sessions pass of useSync is
  performSync: async () => [],
  subscribeToRemoteChanges: async () => () => {},
}))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: net.authSession }) }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ cloudSync: true, loading: false }) }))
vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: async () => 'present',
  getDataKey: async () => net.key,
  ENCRYPTION_MIGRATION_DONE_KEY: 'encryptionMigrationDone',
}))

const DAY = 86_400_000
const BASE = Date.now() - 100 * DAY

const savedGroup = (id: string, name = `Group ${id}`): Group => ({
  ...createGroup(id, name),
  windows: [{ id: 0, incognito: false, focused: false, tabs: [{ id: 0, title: `T ${id}`, url: `https://example.com/${id}` }] }],
})

async function seedGroups(...ids: string[]) {
  const nowOpen = createNowOpenGroup()
  await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, ...ids.map((i) => savedGroup(i))] })
}

const manual = (id: string, createdAt: number): Session => ({ id, name: `manual ${id}`, groups: [savedGroup('m')], createdAt })

beforeEach(async () => {
  await clearDb()
  net.userId = 'user-1'
  net.tier = { tier: 'pro', status: 'active' }
  net.tierError = false
  net.key = await generateDataKey()
  net.rows.clear()
  net.upserts.length = 0
  net.failUpsert = false
  net.failDelete = false
  net.deleted.length = 0
  net.signals.length = 0
  net.onSelect = null
  net.onUpsert = null
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('automatic backup run — real IndexedDB', () => {
  it('creates the session (saved groups only, auto:true) and the state, and uploads it encrypted', async () => {
    await seedGroups('a', 'b')
    const out = await runAutoBackup({ now: BASE })
    expect(out).toMatchObject({ status: 'created', uploaded: true, pruned: 0 })

    const sessions = await getSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].auto).toBe(true)
    expect(sessions[0].groups.map((g) => g.id)).toEqual(['a', 'b'])
    expect(sessions[0].groups.some((g) => g.permanent)).toBe(false)

    const state = (await getSetting<Record<string, unknown> | null>(AUTO_BACKUP_STATE_KEY, null))!
    expect(state.lastBackupAt).toBe(BASE)
    expect(state.lastBackupId).toBe(sessions[0].id)
    expect(state.fingerprint).toBe(await fingerprintGroups(sessions[0].groups))

    // server: ciphertext only, auto flag only inside it
    const row = net.rows.get(sessions[0].id)!
    expect(row.name).toBe('')
    expect(isEncryptedBlob(row.groups)).toBe(true)
    expect(JSON.stringify(row)).not.toContain('example.com')
    expect(JSON.stringify(Object.keys(row))).not.toContain('auto')
    const inside = await decryptBlob<{ auto?: boolean }>(net.key!, row.groups as never)
    expect(inside.auto).toBe(true)
  })

  it('rotation keeps the newest 10 automatic backups and leaves manual sessions alone, locally and on the server', async () => {
    await seedGroups('a')
    await saveSession(manual('m-old', 1))
    await saveSession(manual('m-new', BASE + 999 * DAY))
    for (let i = 0; i < 10; i++) {
      await saveSession({ id: `old${i}`, name: 'x', groups: [savedGroup('z')], createdAt: BASE - (20 - i) * DAY, auto: true })
    }
    const out = await runAutoBackup({ now: BASE })
    expect(out).toMatchObject({ status: 'created', pruned: 1 })

    const sessions = await getSessions()
    expect(sessions.filter(isAutoBackup)).toHaveLength(10)
    expect(sessions.map((s) => s.id)).not.toContain('old0')
    expect(sessions.map((s) => s.id)).toEqual(expect.arrayContaining(['m-old', 'm-new', 'old9']))
    expect(net.deleted.flat()).toEqual(['old0'])
    expect(await getSetting(AUTO_BACKUP_PENDING_DELETES_KEY, null)).toEqual([])
  })

  it('a rotation delete the server did not confirm is remembered, then retried by the next run', async () => {
    await seedGroups('a')
    for (let i = 0; i < 10; i++) {
      await saveSession({ id: `old${i}`, name: 'x', groups: [savedGroup('z')], createdAt: BASE - (20 - i) * DAY, auto: true })
    }
    net.failDelete = true
    await runAutoBackup({ now: BASE })
    expect(await getSetting(AUTO_BACKUP_PENDING_DELETES_KEY, null)).toEqual(['old0'])

    net.failDelete = false
    await seedGroups('a', 'changed')
    await runAutoBackup({ now: BASE + 2 * DAY })
    expect(net.deleted.flat()).toContain('old0')
    expect((await getSetting<string[]>(AUTO_BACKUP_PENDING_DELETES_KEY, [])).includes('old0')).toBe(false)
  })

  it('an upload that cannot happen keeps the backup local and re-arms the sessions self-heal', async () => {
    await seedGroups('a')
    net.key = null
    const out = await runAutoBackup({ now: BASE })
    expect(out).toMatchObject({ status: 'created', uploaded: false })
    expect(await getSessions()).toHaveLength(1)
    expect(net.upserts).toHaveLength(0)
    expect(await getSetting(SESSIONS_MIGRATION_DONE_KEY, true)).toBe(false)
  })

  it('the server rejecting the row behaves the same', async () => {
    await seedGroups('a')
    net.failUpsert = true
    expect(await runAutoBackup({ now: BASE })).toMatchObject({ status: 'created', uploaded: false })
    expect(await getSetting(SESSIONS_MIGRATION_DONE_KEY, true)).toBe(false)
  })

  it('an empty store (only Now Open) leaves existing backups intact and creates nothing', async () => {
    await seedGroups()
    await saveSession({ id: 'keep', name: 'k', groups: [savedGroup('z')], createdAt: BASE - DAY, auto: true })
    expect(await runAutoBackup({ now: BASE, manual: true })).toEqual({ status: 'skipped', reason: 'empty' })
    expect(await runAutoBackup({ now: BASE })).toEqual({ status: 'skipped', reason: 'empty' })
    expect((await getSessions()).map((s) => s.id)).toEqual(['keep'])
    expect(net.deleted).toEqual([])
  })

  it('a free account and an unknown tier never write a session or upload (client-side gate)', async () => {
    await seedGroups('a')
    net.tier = { tier: 'pro', status: 'canceled' }
    expect(await runAutoBackup({ now: BASE, manual: true })).toEqual({ status: 'skipped', reason: 'not-entitled' })
    net.tier = null
    expect(await runAutoBackup({ now: BASE, manual: true })).toEqual({ status: 'skipped', reason: 'not-entitled' })
    net.tierError = true
    expect(await runAutoBackup({ now: BASE, manual: true })).toEqual({ status: 'skipped', reason: 'tier-unknown' })
    expect(await getSessions()).toEqual([])
    expect(net.upserts).toEqual([])
    expect(await getSetting(AUTO_BACKUP_STATE_KEY, null)).toBeNull()
  })

  it('skips when the store belongs to another account', async () => {
    await seedGroups('a')
    await setSetting(LAST_USER_ID_KEY, 'someone-else')
    expect(await runAutoBackup({ now: BASE })).toEqual({ status: 'skipped', reason: 'account-mismatch' })
    expect(await getSessions()).toEqual([])
  })

  it('a second manual run with unchanged groups reports unchanged and adds nothing; a change makes a new backup', async () => {
    await seedGroups('a')
    await runAutoBackup({ now: BASE })
    expect(await runAutoBackup({ now: BASE + 1000, manual: true })).toEqual({ status: 'skipped', reason: 'unchanged' })
    expect(await getSessions()).toHaveLength(1)
    await seedGroups('a', 'b')
    expect((await runAutoBackup({ now: BASE + 2000, manual: true })).status).toBe('created')
    expect(await getSessions()).toHaveLength(2)
  })

  it('same groups but the last backup was deleted: takes a fresh one', async () => {
    await seedGroups('a')
    await runAutoBackup({ now: BASE })
    const [first] = await getSessions()
    await deleteAutoBackup(first.id)
    expect((await runAutoBackup({ now: BASE + 1000, manual: true })).status).toBe('created')
  })

  it('the account wipe clears both backup settings keys, the next account starts with no backup', async () => {
    await seedGroups('a')
    net.failDelete = true
    await deleteAutoBackup('some-id') // leaves a pending remote delete behind
    await runAutoBackup({ now: BASE })
    expect(await getSetting(AUTO_BACKUP_STATE_KEY, null)).not.toBeNull()
    expect(await getSetting(AUTO_BACKUP_PENDING_DELETES_KEY, null)).not.toBeNull()
    await clearLocalAccountData()
    expect(await getSetting(AUTO_BACKUP_STATE_KEY, null)).toBeNull()
    expect(await getSetting(AUTO_BACKUP_PENDING_DELETES_KEY, null)).toBeNull()
    expect(await getSessions()).toEqual([])
  })
})

describe('automatic backup download — real IndexedDB', () => {
  async function remoteBackup(id: string, createdAt: number, groups: Group[] = [savedGroup('r')], extra: Record<string, unknown> = {}) {
    const { iv, ct } = await encryptBlob(net.key!, { name: `Automatic backup ${id}`, groups, auto: true, ...extra })
    net.rows.set(id, { id, user_id: 'user-1', name: '', description: null, groups: { v: 1, iv, ct }, created_at: new Date(createdAt).toISOString() })
  }

  it('downloads into an empty store and seeds the schedule from the newest backup (empty fingerprint)', async () => {
    await remoteBackup('r1', Date.now() - 3 * DAY)
    await remoteBackup('r2', Date.now() - 1 * DAY)
    const out = await downloadAutoBackups()
    expect(out).toEqual({ status: 'done', added: 2, inAccount: 2, unreadable: 0, dropped: 0, removed: 0 })
    const sessions = await getSessions()
    expect(sessions.map((s) => s.id).sort()).toEqual(['r1', 'r2'])
    expect(sessions.every((s) => s.auto === true)).toBe(true)
    expect(await getSetting(AUTO_BACKUP_STATE_KEY, null)).toMatchObject({ lastBackupId: 'r2', fingerprint: '' })
  })

  it('after seeding, the first local backup is not skipped as unchanged', async () => {
    await remoteBackup('r1', Date.now() - 2 * 60 * 60 * 1000)
    await downloadAutoBackups()
    await seedGroups('a')
    expect((await runAutoBackup({ manual: true })).status).toBe('created')
  })

  it('adds missing backups next to existing local ones, never touching local backups, manual sessions or the existing state', async () => {
    await saveSession({ id: 'l1', name: 'local one', groups: [savedGroup('z')], createdAt: Date.now() - 5 * DAY, auto: true })
    await saveSession({ ...manual('m1', 5) })
    const state = { lastBackupAt: Date.now() - DAY, fingerprint: 'fp', lastBackupId: 'l1' }
    await setSetting(AUTO_BACKUP_STATE_KEY, state)
    await remoteBackup('l1', Date.now() - 5 * DAY, [savedGroup('server-version')])
    await remoteBackup('r1', Date.now() - 2 * DAY)
    const out = await downloadAutoBackups()
    expect(out).toEqual({ status: 'done', added: 1, inAccount: 2, unreadable: 0, dropped: 0, removed: 0 })
    const sessions = await getSessions()
    expect(sessions.map((s) => s.id).sort()).toEqual(['l1', 'm1', 'r1'])
    expect(sessions.find((s) => s.id === 'l1')!.name).toBe('local one')
    expect(await getSetting(AUTO_BACKUP_STATE_KEY, null)).toEqual(state)
  })

  it('a backup deleted here stays deleted: the delete reaches the server, and an unconfirmed one is not brought back', async () => {
    await remoteBackup('gone', Date.now() - 2 * DAY)
    await remoteBackup('stay', Date.now() - DAY)
    await downloadAutoBackups()
    expect((await getSessions()).map((s) => s.id).sort()).toEqual(['gone', 'stay'])

    net.failDelete = true
    await deleteAutoBackup('gone')
    expect((await getSessions()).map((s) => s.id)).toEqual(['stay'])
    expect(net.rows.has('gone')).toBe(true) // server never confirmed
    expect(await getSetting(AUTO_BACKUP_PENDING_DELETES_KEY, null)).toEqual(['gone'])

    expect(await downloadAutoBackups()).toMatchObject({ status: 'done', added: 0 })
    expect((await getSessions()).map((s) => s.id)).toEqual(['stay'])

    net.failDelete = false
    await downloadAutoBackups()
    expect(net.rows.has('gone')).toBe(false)
    expect((await getSessions()).map((s) => s.id)).toEqual(['stay'])
    expect(await getSetting(AUTO_BACKUP_PENDING_DELETES_KEY, null)).toEqual([])
  })

  it('ignores manual sessions and untrusted payloads from the server, keeps only valid automatic backups', async () => {
    const { iv, ct } = await encryptBlob(net.key!, { name: 'manual', groups: [savedGroup('x')] })
    net.rows.set('manualrow', { id: 'manualrow', user_id: 'user-1', name: '', description: null, groups: { v: 1, iv, ct }, created_at: new Date(Date.now() - DAY).toISOString() })
    await remoteBackup('truthy', Date.now() - DAY, [savedGroup('x')], { auto: 'true' })
    await remoteBackup('future', Date.now() + 30 * DAY)
    await remoteBackup('ok', Date.now() - DAY)
    const out = await downloadAutoBackups()
    expect(out).toMatchObject({ status: 'done', added: 1 })
    expect((await getSessions()).map((s) => s.id)).toEqual(['ok'])
  })

  it('a locked key writes nothing', async () => {
    await remoteBackup('r1', Date.now() - DAY)
    net.key = null
    expect(await downloadAutoBackups()).toEqual({ status: 'blocked', reason: 'locked' })
    expect(await getSessions()).toEqual([])
    expect(await getSetting(AUTO_BACKUP_STATE_KEY, null)).toBeNull()
  })

  it('a run and a download never overlap (the lock is shared)', async () => {
    await seedGroups('a')
    const [a, b] = await Promise.all([runAutoBackup({ now: BASE }), downloadAutoBackups()])
    const statuses = [a.status === 'skipped' && a.reason === 'busy', b.status === 'busy']
    expect(statuses.some(Boolean) || (a.status === 'created' && b.status === 'done')).toBe(true)
  })
})

describe('restore round trip — real IndexedDB', () => {
  function wrapper({ children }: { children: React.ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return React.createElement(QueryClientProvider, { client: qc }, children)
  }

  it('adds the backup groups next to the current ones with fresh ids and pendingSync, and the originals stay', async () => {
    await seedGroups('a', 'b')
    await runAutoBackup({ now: BASE })
    const [backup] = await getSessions()
    // the live groups change afterwards
    await seedGroups('c')

    const { result } = renderHook(() => useImportGroups(), { wrapper })
    const { importGroups } = await import('@/lib/importExport')
    const { groups } = importGroups(JSON.stringify(backup.groups))
    await result.current.mutateAsync(groups)

    const state = await getGroupsState()
    const saved = state.available.filter((g) => !g.permanent)
    expect(saved).toHaveLength(3)
    expect(saved.map((g) => g.name).sort()).toEqual(['Group a', 'Group b', 'Group c'])
    const restored = saved.filter((g) => g.name !== 'Group c')
    expect(restored.every((g) => g.pendingSync === true)).toBe(true)
    expect(restored.map((g) => g.id)).not.toContain('a')
    expect(restored.map((g) => g.id)).not.toContain('b')
    expect(new Set(state.available.map((g) => g.id)).size).toBe(state.available.length)
    // the backup itself is unchanged
    expect((await getSessions())[0].groups.map((g) => g.id)).toEqual(['a', 'b'])
    expect(state.available[0].permanent).toBe(true)
  })

  it('restoring the same backup twice gives two independent copies', async () => {
    await seedGroups('a')
    await runAutoBackup({ now: BASE })
    const [backup] = await getSessions()
    const { result } = renderHook(() => useImportGroups(), { wrapper })
    const { importGroups } = await import('@/lib/importExport')
    await result.current.mutateAsync(importGroups(JSON.stringify(backup.groups)).groups)
    await waitFor(async () => expect((await getGroupsState()).available.filter((g) => !g.permanent)).toHaveLength(2))
    await result.current.mutateAsync(importGroups(JSON.stringify(backup.groups)).groups)
    const ids = (await getGroupsState()).available.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(4)
  })
})


describe('the sessions flag around a healthy backup — real IndexedDB', () => {
  it('flag true + upload ok: the run ends with the flag true and uploadedAt stamped (no sessions pass needed)', async () => {
    await seedGroups('a')
    await setSetting(SESSIONS_MIGRATION_DONE_KEY, true)
    expect(await runAutoBackup({ now: BASE })).toMatchObject({ status: 'created', uploaded: true })
    expect(await getSetting(SESSIONS_MIGRATION_DONE_KEY, null)).toBe(true)
    const [saved] = await getSessions()
    expect(saved.uploadedAt).toBe(BASE)
  })

  it('flag true + the upload fails: the flag ends false and no uploadedAt is stamped', async () => {
    await seedGroups('a')
    await setSetting(SESSIONS_MIGRATION_DONE_KEY, true)
    net.failUpsert = true
    expect(await runAutoBackup({ now: BASE })).toMatchObject({ status: 'created', uploaded: false })
    expect(await getSetting(SESSIONS_MIGRATION_DONE_KEY, null)).toBe(false)
    expect((await getSessions())[0].uploadedAt).toBeUndefined()
  })

  it('flag false before + upload ok: stays false (a pass is still owed for another reason)', async () => {
    await seedGroups('a')
    await setSetting(SESSIONS_MIGRATION_DONE_KEY, false)
    await runAutoBackup({ now: BASE })
    expect(await getSetting(SESSIONS_MIGRATION_DONE_KEY, null)).toBe(false)
  })
})

describe('a backup deleted while the download is in flight — real IndexedDB', () => {
  async function remoteBackup(id: string, createdAt: number) {
    const { iv, ct } = await encryptBlob(net.key!, { name: `Automatic backup ${id}`, groups: [savedGroup('r')], auto: true })
    net.rows.set(id, { id, user_id: 'user-1', name: '', description: null, groups: { v: 1, iv, ct }, created_at: new Date(createdAt).toISOString() })
  }

  it('deleteAutoBackup between the fetch and the sessions read: nothing is added back, the id stays pending', async () => {
    await saveSession({ id: 'gone', name: 'x', groups: [savedGroup('z')], createdAt: Date.now() - 2 * DAY, auto: true, uploadedAt: 1 })
    await remoteBackup('gone', Date.now() - 2 * DAY)
    net.failDelete = true // the server never confirms: the id must stay remembered
    net.onSelect = async () => {
      await deleteAutoBackup('gone') // the lock is busy (the download holds it): remembered, not sent
    }
    const out = await downloadAutoBackups()
    expect(out).toMatchObject({ status: 'done', added: 0, removed: 0 })
    expect(await getSessions()).toEqual([])
    expect(await getSetting(AUTO_BACKUP_PENDING_DELETES_KEY, null)).toEqual(['gone'])
    expect(net.deleted).toEqual([])
  })

  it('a delete made while the lock is busy is sent by the next run even when that run is not due', async () => {
    await seedGroups('a')
    await saveSession({ id: 'gone', name: 'x', groups: [savedGroup('z')], createdAt: Date.now() - 2 * DAY, auto: true, uploadedAt: 1 })
    await remoteBackup('gone', Date.now() - 2 * DAY)
    net.onSelect = async () => {
      await deleteAutoBackup('gone')
    }
    await downloadAutoBackups()
    expect(net.deleted).toEqual([]) // busy: not sent yet
    expect(await getSetting(AUTO_BACKUP_PENDING_DELETES_KEY, null)).toEqual(['gone'])

    // a scheduled run a minute after a backup: not due, but the claim is followed by a flush
    const recent = Date.now()
    await setSetting('autoBackupState', { lastBackupAt: recent, fingerprint: 'x', lastBackupId: 'z' })
    expect(await runAutoBackup({ now: recent + 60_000 })).toEqual({ status: 'skipped', reason: 'not-due' })
    expect(net.deleted.flat()).toEqual(['gone'])
    expect(net.rows.has('gone')).toBe(false)
    expect(await getSetting(AUTO_BACKUP_PENDING_DELETES_KEY, null)).toEqual([])
  })
})

describe('useSync sessions pass with a session deleted mid-pass — real IndexedDB', () => {
  function wrapper({ children }: { children: React.ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return React.createElement(QueryClientProvider, { client: qc }, children)
  }
  const manualSession = (id: string): Session => ({ id, name: id, groups: [savedGroup('m')], createdAt: Date.now() - DAY })

  it('the user deletes a session while its upload is in flight: its server row is deleted again afterwards', async () => {
    await saveSession(manualSession('s1'))
    await setSetting(SESSIONS_MIGRATION_DONE_KEY, false)
    net.onUpsert = async (id) => {
      await deleteSession(id)
    }
    renderHook(() => useSync(), { wrapper })
    await waitFor(() => expect(net.deleted.flat()).toEqual(['s1']), { timeout: 5000 })
    expect(await getSessions()).toEqual([])
  })

  it('an account wipe mid-pass (clearLocalAccountData): nothing is deleted in the account', async () => {
    await saveSession(manualSession('s1'))
    await setSetting(SESSIONS_MIGRATION_DONE_KEY, false)
    net.onUpsert = async () => {
      await clearLocalAccountData()
    }
    renderHook(() => useSync(), { wrapper })
    await waitFor(() => expect(net.upserts.length).toBeGreaterThan(0), { timeout: 5000 })
    await new Promise((r) => setTimeout(r, 300))
    expect(net.deleted).toEqual([])
    expect(await getSessions()).toEqual([])
  })

  it('a session that stays is not deleted, and the pass marks the flag done', async () => {
    await saveSession(manualSession('s1'))
    await setSetting(SESSIONS_MIGRATION_DONE_KEY, false)
    renderHook(() => useSync(), { wrapper })
    await waitFor(async () => expect(await getSetting(SESSIONS_MIGRATION_DONE_KEY, null)).toBe(true), { timeout: 5000 })
    expect(net.deleted).toEqual([])
    expect(net.rows.has('s1')).toBe(true)
  })
})
