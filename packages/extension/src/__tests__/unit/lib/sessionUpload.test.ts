import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AUTO_ITEM_COLORS, decryptBlob, generateDataKey, isEncryptedBlob } from '@tabmerger/shared'
import type { Session } from '@/lib/types'
import {
  deleteRemoteSessions,
  deleteRemoteSessionsQueued,
  noteSessionDeletedHere,
  pushSessionToSupabase,
  queueSessionUpload,
  refreshUploadedSession,
  sessionContent,
  uploadStoredSession,
} from '@/lib/sessionUpload'

const h = vi.hoisted(() => ({
  auth: { user: { id: 'user-1' } } as unknown,
  gate: { key: null } as { key: CryptoKey | null; reason?: string },
  firefoxOk: true,
  upsertError: null as unknown,
  deleteError: null as unknown,
  deleteThrows: false,
  upserts: [] as Record<string, unknown>[],
  deletes: [] as { ids: string[]; userId: unknown }[],
  updates: [] as Record<string, unknown>[],
  requests: [] as { op: string; signal?: unknown; filters: unknown[][] }[],
  onRead: null as null | (() => void),
  readRow: { id: 's1' } as unknown,
  readError: null as unknown,
  updateRows: [{ id: 's1' }] as unknown,
  updateError: null as unknown,
  /** awaited before an upsert is recorded (to hold an upload in flight) */
  beforeUpsert: null as null | (() => Promise<void>),
  /** every request in the order it COMPLETED */
  done: [] as string[],
  /** the local sessions store (getSession / markSessionUploaded) */
  local: new Map<string, Record<string, unknown>>(),
  marks: [] as unknown[][],
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: h.auth } })) },
    from: vi.fn(() => {
      // one chainable builder; every request must end with .abortSignal() (or maybeSingle after it)
      const q: { op: string; payload?: unknown; filters: unknown[][]; signal?: unknown; selected?: string } = { op: '', filters: [] }
      const b: Record<string, unknown> = {}
      const finish = async () => {
        h.requests.push({ ...q })
        if (q.op === 'upsert') {
          await h.beforeUpsert?.()
          h.upserts.push(q.payload as Record<string, unknown>)
          h.done.push(`upsert:${(q.payload as { id: string }).id}`)
          return { error: h.upsertError }
        }
        if (q.op === 'delete') {
          if (h.deleteThrows) throw new Error('offline')
          const ids = (q.filters.find((f) => f[0] === 'in') as unknown[])[2] as string[]
          const userId = (q.filters.find((f) => f[0] === 'eq' && f[1] === 'user_id') as unknown[])[2]
          h.deletes.push({ ids, userId })
          h.done.push(`delete:${ids.join()}`)
          return { error: h.deleteError }
        }
        if (q.op === 'update') {
          h.updates.push(q.payload as Record<string, unknown>)
          return { data: h.updateRows, error: h.updateError }
        }
        h.onRead?.()
        return { data: h.readRow, error: h.readError }
      }
      b.upsert = (row: unknown) => ((q.op = 'upsert'), (q.payload = row), b)
      b.update = (row: unknown) => ((q.op = 'update'), (q.payload = row), b)
      b.delete = () => ((q.op = 'delete'), b)
      b.select = (cols: string) => ((q.op ||= 'select'), (q.selected = cols), b)
      b.in = (c: string, v: unknown) => (q.filters.push(['in', c, v]), b)
      b.eq = (c: string, v: unknown) => (q.filters.push(['eq', c, v]), b)
      b.abortSignal = (sig: unknown) => {
        q.signal = sig
        const p = finish()
        // `.select('id').abortSignal()` / `.abortSignal().maybeSingle()` both end the chain here
        return Object.assign(p, { maybeSingle: () => p })
      }
      return b
    }),
  },
}))
vi.mock('@/lib/contentUploadKey', () => ({
  getContentUploadKey: vi.fn(async () => h.gate),
  UPLOAD_BLOCKED_MESSAGE: { 'no-key': 'no key', unknown: 'unknown', locked: 'locked' },
}))
vi.mock('@/lib/syncEngine', () => ({ canUploadOnFirefox: vi.fn(async () => h.firefoxOk) }))
vi.mock('@/lib/localDb', () => ({
  getSession: vi.fn(async (id: string) => h.local.get(id)),
  markSessionUploaded: vi.fn(async (id: string, at: number, token?: number) => {
    h.marks.push([id, at, token])
    const row = h.local.get(id)
    if (!row) return
    const next: Record<string, unknown> = { ...row, uploadedAt: at }
    if (token !== undefined && row.uploadPending === token) delete next.uploadPending
    h.local.set(id, next)
  }),
}))

const base: Session = {
  id: 's1',
  name: 'SECRET NAME',
  description: 'SECRET DESC',
  groups: [{ id: 'g', name: 'SECRET GROUP', color: 'c', updatedAt: 1, windows: [] }],
  createdAt: Date.UTC(2030, 0, 2),
}

let key: CryptoKey
beforeEach(async () => {
  key = await generateDataKey()
  h.auth = { user: { id: 'user-1' } }
  h.gate = { key }
  h.firefoxOk = true
  h.upsertError = null
  h.deleteError = null
  h.deleteThrows = false
  h.upserts.length = 0
  h.deletes.length = 0
  h.updates.length = 0
  h.requests.length = 0
  h.readRow = { id: 's1' }
  h.onRead = null
  h.readError = null
  h.updateRows = [{ id: 's1' }]
  h.updateError = null
  h.beforeUpsert = null
  h.done.length = 0
  h.local.clear()
  h.marks.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('pushSessionToSupabase', () => {
  it('uploads ciphertext only; plaintext columns are blank', async () => {
    expect(await pushSessionToSupabase(base, 'user-1')).toBe(true)
    const row = h.upserts[0]
    expect(row).toMatchObject({ id: 's1', user_id: 'user-1', name: '', description: null, created_at: '2030-01-02T00:00:00.000Z' })
    expect(isEncryptedBlob(row.groups)).toBe(true)
    expect(JSON.stringify(row)).not.toContain('SECRET')
  })

  it('puts auto:true inside the encrypted payload only, never a plaintext column', async () => {
    await pushSessionToSupabase({ ...base, auto: true }, 'user-1')
    const row = h.upserts[0]
    expect(Object.keys(row).sort()).toEqual(['created_at', 'description', 'groups', 'id', 'name', 'user_id'])
    expect(JSON.stringify(row)).not.toContain('auto')
    const content = await decryptBlob<Record<string, unknown>>(key, row.groups as never)
    expect(content.auto).toBe(true)
    expect(content.name).toBe('SECRET NAME')
  })

  it.each([[undefined], [false], ['true'], [1]])('a manual session (auto=%s) has no auto key in its blob', async (auto) => {
    await pushSessionToSupabase({ ...base, auto: auto as unknown as boolean }, 'user-1')
    const content = await decryptBlob<Record<string, unknown>>(key, h.upserts[0].groups as never)
    expect('auto' in content).toBe(false)
  })

  it('sends nothing when signed out', async () => {
    h.auth = null
    expect(await pushSessionToSupabase(base, 'user-1')).toBe(false)
    expect(h.upserts).toEqual([])
  })

  it('sends nothing when Firefox consent is missing', async () => {
    h.firefoxOk = false
    expect(await pushSessionToSupabase(base, 'user-1')).toBe(false)
    expect(h.upserts).toEqual([])
  })

  it.each(['no-key', 'unknown', 'locked'])('sends nothing when the key gate says %s', async (reason) => {
    h.gate = { key: null, reason }
    expect(await pushSessionToSupabase(base, 'user-1')).toBe(false)
    expect(h.upserts).toEqual([])
  })

  it('resolves false when the server rejects the row', async () => {
    h.upsertError = { message: 'rls' }
    expect(await pushSessionToSupabase(base, 'user-1')).toBe(false)
  })
})

describe('deleteRemoteSessions', () => {
  it('an empty list is trivially confirmed with no request', async () => {
    expect(await deleteRemoteSessions([], 'user-1')).toBe(true)
    expect(h.deletes).toEqual([])
  })

  it('deletes the ids scoped to the signed-in user', async () => {
    expect(await deleteRemoteSessions(['a', 'b'], 'user-1')).toBe(true)
    expect(h.deletes).toEqual([{ ids: ['a', 'b'], userId: 'user-1' }])
  })

  it('is not confirmed when signed out', async () => {
    h.auth = null
    expect(await deleteRemoteSessions(['a'], 'user-1')).toBe(false)
    expect(h.deletes).toEqual([])
  })

  it('is not confirmed on a server error', async () => {
    h.deleteError = { message: 'nope' }
    expect(await deleteRemoteSessions(['a'], 'user-1')).toBe(false)
  })

  it('never throws: a thrown request is not confirmed', async () => {
    h.deleteThrows = true
    expect(await deleteRemoteSessions(['a'], 'user-1')).toBe(false)
  })
})


describe('every request carries an abort signal', () => {
  it('upsert, refresh read, refresh update and delete', async () => {
    await pushSessionToSupabase(base, 'user-1')
    await refreshUploadedSession(base, 'user-1')
    await deleteRemoteSessions(['a'], 'user-1')
    expect(h.requests.map((r) => r.op).sort()).toEqual(['delete', 'select', 'update', 'upsert'])
    for (const r of h.requests) expect(r.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('refreshUploadedSession', () => {
  it('updates exactly one row and reports updated; the row content is ciphertext', async () => {
    expect(await refreshUploadedSession({ ...base, auto: true }, 'user-1')).toBe('updated')
    expect(h.updates).toHaveLength(1)
    expect(isEncryptedBlob(h.updates[0].groups)).toBe(true)
    expect(JSON.stringify(h.updates[0])).not.toContain('SECRET')
  })

  it('UPDATE selects the written ids and is scoped to the id and the user', async () => {
    await refreshUploadedSession(base, 'user-1')
    const upd = h.requests.find((r) => r.op === 'update')!
    expect(upd.filters).toEqual(expect.arrayContaining([['eq', 'id', 's1'], ['eq', 'user_id', 'user-1']]))
  })

  it.each([
    ['zero rows', []],
    ['two rows', [{ id: 's1' }, { id: 's1' }]],
    ['null data', null],
    ['not an array', { id: 's1' }],
  ])('an UPDATE answered with %s is failed, not updated', async (_n, rows) => {
    h.updateRows = rows
    expect(await refreshUploadedSession(base, 'user-1')).toBe('failed')
  })

  it('an UPDATE error is failed', async () => {
    h.updateError = { message: 'rls' }
    h.updateRows = null
    expect(await refreshUploadedSession(base, 'user-1')).toBe('failed')
  })

  it('a read that returns no row is gone, and nothing is written', async () => {
    h.readRow = null
    expect(await refreshUploadedSession(base, 'user-1')).toBe('gone')
    expect(h.updates).toEqual([])
    expect(h.upserts).toEqual([])
  })

  it('a read error is failed (never gone)', async () => {
    h.readRow = null
    h.readError = { message: 'x' }
    expect(await refreshUploadedSession(base, 'user-1')).toBe('failed')
  })

  it('signed out: failed with no request', async () => {
    h.auth = null
    expect(await refreshUploadedSession(base, 'user-1')).toBe('failed')
    expect(h.requests).toEqual([])
  })

  it('a client that signs out during the read (RLS shows it no row) is failed, never gone', async () => {
    h.readRow = null
    h.onRead = () => void (h.auth = null)
    expect(await refreshUploadedSession(base, 'user-1')).toBe('failed')
  })

  it('no key: failed with no request; Firefox consent missing: failed', async () => {
    h.gate = { key: null, reason: 'locked' }
    expect(await refreshUploadedSession(base, 'user-1')).toBe('failed')
    expect(h.requests).toEqual([])
    h.gate = { key }
    h.firefoxOk = false
    expect(await refreshUploadedSession(base, 'user-1')).toBe('failed')
  })
})

describe('session colour (inside the ciphertext only)', () => {
  it('a palette colour travels inside the encrypted blob, never in a plaintext column', async () => {
    const color = AUTO_ITEM_COLORS[3]
    await pushSessionToSupabase({ ...base, color }, 'user-1')
    const row = h.upserts[0]
    expect(Object.keys(row).sort()).toEqual(['created_at', 'description', 'groups', 'id', 'name', 'user_id'])
    expect(JSON.stringify(row)).not.toContain('rgba')
    const content = await decryptBlob<Record<string, unknown>>(key, row.groups as never)
    expect(content.color).toBe(color)
  })

  it.each([['rgba(1, 2, 3, 1)'], ['red'], [''], [42]])('a colour outside the palette (%s) is not uploaded', async (color) => {
    await pushSessionToSupabase({ ...base, color: color as unknown as string }, 'user-1')
    const content = await decryptBlob<Record<string, unknown>>(key, h.upserts[0].groups as never)
    expect('color' in content).toBe(false)
  })

  it('a refresh re-encrypts the colour too', async () => {
    expect(await refreshUploadedSession({ ...base, color: AUTO_ITEM_COLORS[0] }, 'user-1')).toBe('updated')
    const content = await decryptBlob<Record<string, unknown>>(key, h.updates[0].groups as never)
    expect(content.color).toBe(AUTO_ITEM_COLORS[0])
  })

  it('sessionContent keeps name, groups and description as before', () => {
    expect(sessionContent({ ...base, color: AUTO_ITEM_COLORS[1] })).toEqual({
      name: base.name,
      groups: base.groups,
      description: base.description,
      color: AUTO_ITEM_COLORS[1],
    })
  })
})

describe('uploadStoredSession: one upload per session, the stored copy, update-only once on the server', () => {
  const manual = (extra: Record<string, unknown> = {}) => ({ ...base, ...extra }) as unknown as Record<string, unknown>

  it('uploads the copy stored when its turn comes, stamps uploadedAt and clears that upload\'s pending token', async () => {
    h.local.set('s1', manual({ color: AUTO_ITEM_COLORS[1], uploadPending: 7 }))
    expect(await uploadStoredSession('s1', 'user-1')).toBe('uploaded')
    expect(h.upserts).toHaveLength(1)
    const content = await decryptBlob<Record<string, unknown>>(key, h.upserts[0].groups as never)
    expect(content.color).toBe(AUTO_ITEM_COLORS[1])
    expect(h.local.get('s1')!.uploadedAt).toEqual(expect.any(Number))
    expect('uploadPending' in h.local.get('s1')!).toBe(false)
  })

  it('a session the server already has is UPDATED only, never inserted', async () => {
    h.local.set('s1', manual({ uploadedAt: 3, uploadPending: 8 }))
    expect(await uploadStoredSession('s1', 'user-1')).toBe('refreshed')
    expect(h.upserts).toHaveLength(0)
    expect(h.updates).toHaveLength(1)
    expect('uploadPending' in h.local.get('s1')!).toBe(false)
  })

  it('one deleted in the dashboard (gone on the server) is not re-created and stays here', async () => {
    h.local.set('s1', manual({ uploadedAt: 3, uploadPending: 8 }))
    h.readRow = null
    expect(await uploadStoredSession('s1', 'user-1')).toBe('gone-remote')
    expect(h.upserts).toHaveLength(0)
    expect(h.updates).toHaveLength(0)
    expect(h.local.has('s1')).toBe(true)
    expect(h.deletes).toHaveLength(0)
  })

  it('a session no longer stored sends nothing', async () => {
    expect(await uploadStoredSession('nope', 'user-1')).toBe('gone-local')
    expect(h.requests).toEqual([])
  })

  it('a failed upload keeps the pending token for the retry and stamps nothing', async () => {
    h.local.set('s1', manual({ uploadPending: 7 }))
    h.upsertError = { message: 'rejected' }
    expect(await uploadStoredSession('s1', 'user-1')).toBe('failed')
    expect(h.local.get('s1')!.uploadPending).toBe(7)
    expect(h.marks).toEqual([])
  })

  it('a change made while the upload ran keeps its own pending token', async () => {
    h.local.set('s1', manual({ uploadPending: 7 }))
    h.beforeUpsert = async () => {
      h.local.set('s1', { ...h.local.get('s1')!, color: AUTO_ITEM_COLORS[4], uploadPending: 9 })
    }
    await uploadStoredSession('s1', 'user-1')
    expect(h.local.get('s1')!.uploadPending).toBe(9)
  })

  it('two quick colour picks upload in order: the later colour lands last', async () => {
    h.local.set('s1', manual({ color: AUTO_ITEM_COLORS[0], uploadPending: 1 }))
    let release!: () => void
    h.beforeUpsert = () => new Promise<void>((r) => (release = r))
    const first = uploadStoredSession('s1', 'user-1')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    // the second pick is stored while the first upload is in flight
    h.local.set('s1', { ...h.local.get('s1')!, color: AUTO_ITEM_COLORS[5], uploadPending: 2 })
    const second = uploadStoredSession('s1', 'user-1')
    h.beforeUpsert = null
    release()
    await Promise.all([first, second])
    const last = await decryptBlob<Record<string, unknown>>(key, (h.updates.at(-1) ?? h.upserts.at(-1))!.groups as never)
    expect(last.color).toBe(AUTO_ITEM_COLORS[5])
    // the first insert stamped it, so the second one is an update
    expect(h.upserts).toHaveLength(1)
    expect(h.updates).toHaveLength(1)
  })

  it('a delete during the upload: the queued remote delete lands AFTER the upsert, so no row is resurrected', async () => {
    h.local.set('s1', manual({ uploadPending: 1 }))
    let release!: () => void
    h.beforeUpsert = () => new Promise<void>((r) => (release = r))
    const upload = uploadStoredSession('s1', 'user-1')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    // what useDeleteSession does
    noteSessionDeletedHere('s1')
    h.local.delete('s1')
    const del = deleteRemoteSessionsQueued(['s1'], 'user-1')
    release()
    await Promise.all([upload, del])
    // the upsert first; then the delete (the upload's own re-check may send a second one: harmless)
    expect(h.done[0]).toBe('upsert:s1')
    expect(h.done.slice(1).length).toBeGreaterThan(0)
    expect(h.done.slice(1).every((op) => op === 'delete:s1')).toBe(true)
  })

  it('deleted here while the upload ran (its remote delete sent earlier): the upload deletes the row it re-created', async () => {
    h.local.set('s1', manual({ uploadPending: 1 }))
    h.beforeUpsert = async () => {
      noteSessionDeletedHere('s1')
      h.local.delete('s1')
    }
    expect(await uploadStoredSession('s1', 'user-1')).toBe('uploaded')
    expect(h.done).toEqual(['upsert:s1', 'delete:s1'])
    expect(h.deletes).toEqual([{ ids: ['s1'], userId: 'user-1' }])
  })

  it('a session gone after its upload without a delete here (a wipe) is never deleted on the server', async () => {
    h.local.set('wiped', manual({ id: 'wiped', uploadPending: 1 }))
    h.beforeUpsert = async () => void h.local.delete('wiped')
    await uploadStoredSession('wiped', 'user-1')
    expect(h.deletes).toHaveLength(0)
  })

  it('queueSessionUpload runs tasks of one id in order even when one fails; other ids do not wait', async () => {
    const order: string[] = []
    let releaseA!: () => void
    const a = queueSessionUpload('x', () => new Promise<void>((r) => (releaseA = r)).then(() => void order.push('a')))
    const b = queueSessionUpload('x', async () => {
      order.push('b')
      throw new Error('boom')
    })
    const c = queueSessionUpload('x', async () => void order.push('c'))
    await queueSessionUpload('y', async () => void order.push('other'))
    expect(order).toEqual(['other'])
    releaseA()
    await a
    await expect(b).rejects.toThrow('boom')
    await c
    expect(order).toEqual(['other', 'a', 'b', 'c'])
  })
})
