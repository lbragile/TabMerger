import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateDataKey } from '@tabmerger/shared'
import type { Session } from '@/lib/types'

// Real IndexedDB (fake-indexeddb) + the REAL lib/sessionUpload.ts; only the network edge (a tiny
// in-memory `sessions` table) and the key gate are faked. Two "popups" are two upload flows on the
// same store: what one context deletes, the other must honour (S3).

const remote = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  /** awaited inside an upsert, before the row is written (holds a request in flight) */
  duringUpsert: null as null | (() => Promise<void>),
  deletes: [] as string[][],
  auth: { user: { id: 'u1' }, access_token: 't1' } as Record<string, unknown> | null,
  gate: { key: null as CryptoKey | null, keyFingerprint: 'key-B' as string | undefined },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: remote.auth } })) },
    from: vi.fn(() => {
      const q: { op: string; payload?: Record<string, unknown>; filters: Record<string, unknown>; inIds?: string[] } = { op: '', filters: {} }
      const b: Record<string, unknown> = {}
      const run = async () => {
        if (q.op === 'upsert') {
          await remote.duringUpsert?.()
          remote.rows.set(q.payload!.id as string, { ...q.payload })
          return { error: null }
        }
        if (q.op === 'delete') {
          remote.deletes.push(q.inIds ?? [])
          for (const id of q.inIds ?? []) remote.rows.delete(id)
          return { error: null }
        }
        if (q.op === 'update') {
          const row = remote.rows.get(q.filters.id as string)
          if (!row) return { data: [], error: null }
          Object.assign(row, q.payload)
          return { data: [{ id: row.id }], error: null }
        }
        const row = remote.rows.get(q.filters.id as string)
        return { data: row ? { id: row.id } : null, error: null }
      }
      b.upsert = (row: Record<string, unknown>) => ((q.op = 'upsert'), (q.payload = row), b)
      b.update = (row: Record<string, unknown>) => ((q.op = 'update'), (q.payload = row), b)
      b.delete = () => ((q.op = 'delete'), b)
      b.select = () => ((q.op ||= 'select'), b)
      b.in = (_c: string, ids: string[]) => ((q.inIds = ids), b)
      b.eq = (c: string, v: unknown) => ((q.filters[c] = v), b)
      b.abortSignal = () => {
        const p = run()
        return Object.assign(p, { maybeSingle: () => p })
      }
      return b
    }),
  },
}))
vi.mock('@/lib/contentUploadKey', () => ({
  getContentUploadKey: vi.fn(async () => (remote.gate.key ? { key: remote.gate.key, ...(remote.gate.keyFingerprint ? { keyFingerprint: remote.gate.keyFingerprint } : {}) } : { key: null, reason: 'locked' })),
  UPLOAD_BLOCKED_MESSAGE: { 'no-key': 'no key', unknown: 'unknown', locked: 'locked' },
}))
vi.mock('@/lib/syncEngine', () => ({ canUploadOnFirefox: vi.fn(async () => true) }))

import { deleteSession, getSession, saveSession, wasSessionDeletedHere, liveDeletedSessionIds, commitSessions } from '@/lib/localDb'
import { uploadStoredSession } from '@/lib/sessionUpload'
import { SESSIONS_DELETED_HERE_KEY, SESSION_DELETED_HERE_MAX, SESSION_DELETED_HERE_TTL_MS } from '@/lib/syncSettingKeys'
import { clearDb } from './dbTestUtils'
import { getDb } from '@/lib/localDb'

const session = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: id, groups: [], createdAt: 1, ...extra })

beforeEach(async () => {
  await clearDb()
  remote.rows.clear()
  remote.deletes.length = 0
  remote.duringUpsert = null
  remote.auth = { user: { id: 'u1' }, access_token: 't1' }
  remote.gate = { key: await generateDataKey(), keyFingerprint: 'key-B' }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('S3: a user delete is remembered in IndexedDB, in the delete transaction', () => {
  it('the local delete and the remembered id land together', async () => {
    await saveSession(session('s1'))
    await deleteSession('s1')
    expect(await getSession('s1')).toBeUndefined()
    expect(await wasSessionDeletedHere('s1')).toBe(true)
    expect(await wasSessionDeletedHere('other')).toBe(false)
  })

  it("popup B's first upload re-created a row popup A deleted meanwhile: B deletes it again", async () => {
    await saveSession(session('s1', { uploadPending: 1 }))
    // popup A deletes the session (locally, remembered, and its remote delete) while B's upsert is in flight
    remote.duringUpsert = async () => {
      await deleteSession('s1')
      remote.rows.delete('s1')
    }
    expect(await uploadStoredSession('s1', 'u1')).toBe('uploaded')
    expect(remote.rows.has('s1')).toBe(false)
    expect(remote.deletes).toEqual([['s1']])
  })

  it('a wipe (no remembered id) never deletes the re-created row', async () => {
    await saveSession(session('s1', { uploadPending: 1 }))
    remote.duringUpsert = async () => {
      const db = await getDb()
      await db.delete('sessions', 's1') // the store emptied without a user delete
    }
    await uploadStoredSession('s1', 'u1')
    expect(remote.rows.has('s1')).toBe(true)
    expect(remote.deletes).toEqual([])
  })

  it('remembered ids expire and are capped', () => {
    const now = 10 * SESSION_DELETED_HERE_TTL_MS
    const raw: Record<string, number> = { fresh: now - 1000, old: now - SESSION_DELETED_HERE_TTL_MS, bad: Number.NaN as unknown as number }
    expect(Object.keys(liveDeletedSessionIds(raw, now))).toEqual(['fresh'])
    const many = Object.fromEntries(Array.from({ length: SESSION_DELETED_HERE_MAX + 20 }, (_, i) => [`id${i}`, now - i]))
    const kept = liveDeletedSessionIds(many, now)
    expect(Object.keys(kept)).toHaveLength(SESSION_DELETED_HERE_MAX)
    expect('id0' in kept).toBe(true)
    expect(`id${SESSION_DELETED_HERE_MAX + 19}` in kept).toBe(false)
    expect(liveDeletedSessionIds('junk', now)).toEqual({})
  })

  it('the remembered ids are account-scoped: the account wipe removes them', async () => {
    const { clearLocalAccountData, getSetting } = await import('@/lib/localDb')
    await saveSession(session('s1'))
    await deleteSession('s1')
    await clearLocalAccountData()
    expect(await getSetting(SESSIONS_DELETED_HERE_KEY, null)).toBeNull()
  })
})

describe('S1: the key a copy was uploaded under', () => {
  it('a first upload records the key; the old-key row deleted in the dashboard is re-inserted under the new key', async () => {
    remote.gate.keyFingerprint = 'key-A'
    await saveSession(session('s1', { uploadPending: 1 }))
    expect(await uploadStoredSession('s1', 'u1')).toBe('uploaded')
    expect((await getSession('s1'))?.uploadedKey).toBe('key-A')

    // encryption reset elsewhere (new key B); the user deletes the unreadable old-key row in the dashboard
    remote.gate.keyFingerprint = 'key-B'
    remote.rows.delete('s1')
    await commitSessions({ putSessions: [{ ...(await getSession('s1'))!, uploadPending: 2 }] })
    expect(await uploadStoredSession('s1', 'u1')).toBe('reinserted')
    expect(remote.rows.has('s1')).toBe(true)
    expect(await getSession('s1')).toMatchObject({ uploadedKey: 'key-B' })
    expect((await getSession('s1'))?.uploadPending).toBeUndefined()

    // under the same key, a later dashboard delete is a real delete: not re-created
    remote.rows.delete('s1')
    await commitSessions({ putSessions: [{ ...(await getSession('s1'))!, uploadPending: 3 }] })
    expect(await uploadStoredSession('s1', 'u1')).toBe('gone-remote')
    expect(remote.rows.has('s1')).toBe(false)
    expect(await getSession('s1')).toBeDefined()
  })

  it('S7: a sign-out and sign-in as the same user during the read is failed, never gone', async () => {
    await saveSession(session('s1', { uploadedAt: 1, uploadedKey: 'key-B', uploadPending: 1 }))
    const { supabase } = await import('@/lib/supabase')
    let calls = 0
    vi.mocked(supabase.auth.getSession).mockImplementation(async () => {
      calls++
      // calls 1-2: the identity check and the token before the read; from the 3rd (after the read) a new sign-in
      return { data: { session: { user: { id: 'u1' }, access_token: calls > 2 ? 't2' : 't1' } } } as never
    })
    expect(await uploadStoredSession('s1', 'u1')).toBe('failed')
    expect((await getSession('s1'))?.uploadPending).toBe(1)
    vi.mocked(supabase.auth.getSession).mockImplementation(async () => ({ data: { session: remote.auth } }) as never)
  })

  it('markUploaded in a sessions transaction records the key and clears only its own pending token', async () => {
    await saveSession(session('b1', { auto: true, uploadPending: 5 }))
    await saveSession(session('b2', { auto: true, uploadPending: 9 }))
    await commitSessions({ markUploaded: { ids: ['b1', 'b2'], at: 7, pending: 5, keyFingerprint: 'key-B' } })
    expect(await getSession('b1')).toMatchObject({ uploadedAt: 7, uploadedKey: 'key-B' })
    expect((await getSession('b1'))?.uploadPending).toBeUndefined()
    // a later change's token is kept
    expect((await getSession('b2'))?.uploadPending).toBe(9)
  })
})
