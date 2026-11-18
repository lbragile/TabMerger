import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { AUTO_ITEM_COLORS, decryptBlob, generateDataKey } from '@tabmerger/shared'
import { getSessions, saveSession } from '@/lib/localDb'
import type { Session } from '@/lib/types'
import { clearDb } from './dbTestUtils'

// Real IndexedDB; only the network edge (a tiny `sessions` table) and the key lookup are faked.
// A colour change uploads the session AS STORED, one upload per session at a time, update-only once
// the server has it; a delete made while that upload is in flight must not leave a resurrected row.

const net = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  log: [] as string[],
  hold: null as null | { entered: () => void; released: Promise<void> },
  key: null as CryptoKey | null,
}))

vi.mock('@/lib/supabase', () => {
  const from = () => {
    const q: { op: string; payload?: Record<string, unknown>; filters: [string, string, unknown][] } = { op: 'select', filters: [] }
    const run = async () => {
      const idFilter = q.filters.find((f) => f[1] === 'id')
      const ids = idFilter ? (Array.isArray(idFilter[2]) ? (idFilter[2] as string[]) : [idFilter[2] as string]) : []
      if (q.op === 'upsert') {
        const gate = net.hold
        if (gate) {
          net.hold = null
          gate.entered()
          await gate.released
        }
        net.rows.set(q.payload!.id as string, q.payload!)
        net.log.push(`upsert:${q.payload!.id}`)
        return { error: null }
      }
      if (q.op === 'update') {
        const hit = ids.filter((id) => net.rows.has(id))
        for (const id of hit) net.rows.set(id, { ...net.rows.get(id)!, ...q.payload })
        net.log.push(`update:${ids.join()}`)
        return { data: hit.map((id) => ({ id })), error: null }
      }
      if (q.op === 'delete') {
        for (const id of ids) net.rows.delete(id)
        net.log.push(`delete:${ids.join()}`)
        return { error: null }
      }
      const row = ids.map((id) => net.rows.get(id)).find(Boolean)
      return { data: row ? { id: row.id } : null, error: null }
    }
    const b: Record<string, unknown> = {}
    b.upsert = (row: Record<string, unknown>) => ((q.op = 'upsert'), (q.payload = row), b)
    b.update = (row: Record<string, unknown>) => ((q.op = 'update'), (q.payload = row), b)
    b.delete = () => ((q.op = 'delete'), b)
    b.select = () => b
    b.eq = (c: string, v: unknown) => (q.filters.push(['eq', c, v]), b)
    b.in = (c: string, v: unknown) => (q.filters.push(['in', c, v]), b)
    b.abortSignal = () => {
      const p = run()
      return Object.assign(p, { maybeSingle: () => p })
    }
    return b
  }
  return {
    supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }) }, from },
    isSupabaseConfigured: true,
  }
})
vi.mock('@/lib/contentUploadKey', () => ({
  getContentUploadKey: async () => ({ key: net.key }),
  UPLOAD_BLOCKED_MESSAGE: { 'no-key': 'no key', unknown: 'unknown', locked: 'locked' },
}))
vi.mock('@/lib/syncEngine', () => ({ canUploadOnFirefox: async () => true }))

import { useDeleteSession, useUpdateSessionColor } from '@/hooks/useSessions'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

const session = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: `Session ${id}`, groups: [], createdAt: Date.now(), ...extra })

beforeEach(async () => {
  await clearDb()
  net.rows.clear()
  net.log.length = 0
  net.hold = null
  net.key = await generateDataKey()
})

describe('session colour upload races — real IndexedDB', () => {
  it('a delete during the colour upload: the server ends up without the row, and so does this device', async () => {
    await saveSession(session('s1'))
    let entered!: () => void
    const inFlight = new Promise<void>((r) => (entered = r))
    let release!: () => void
    net.hold = { entered: () => entered(), released: new Promise<void>((r) => (release = r)) }

    const color = renderHook(() => useUpdateSessionColor(), { wrapper })
    const del = renderHook(() => useDeleteSession(), { wrapper })
    let colorDone!: Promise<unknown>
    act(() => {
      colorDone = color.result.current.mutateAsync({ id: 's1', color: AUTO_ITEM_COLORS[3], cloudSync: true })
    })
    await inFlight
    let deleteDone!: Promise<unknown>
    act(() => {
      deleteDone = del.result.current.mutateAsync('s1')
    })
    // the local delete is done while the upsert is still held
    await vi.waitFor(async () => expect(await getSessions()).toEqual([]))
    release()
    await act(async () => {
      await Promise.all([colorDone, deleteDone])
    })
    expect(net.rows.has('s1')).toBe(false)
    expect(net.log[0]).toBe('upsert:s1')
    expect(net.log.at(-1)).toBe('delete:s1')
  })

  it('first colour change inserts the row and stamps the session; the next one only updates it', async () => {
    await saveSession(session('s1'))
    const { result } = renderHook(() => useUpdateSessionColor(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: 's1', color: AUTO_ITEM_COLORS[1], cloudSync: true })
    })
    const [afterFirst] = await getSessions()
    expect(afterFirst.uploadedAt).toEqual(expect.any(Number))
    expect(afterFirst.uploadPending).toBeUndefined()
    await act(async () => {
      await result.current.mutateAsync({ id: 's1', color: AUTO_ITEM_COLORS[6], cloudSync: true })
    })
    expect(net.log).toEqual(['upsert:s1', 'update:s1'])
    const blob = net.rows.get('s1')!.groups as never
    expect((await decryptBlob<Record<string, unknown>>(net.key!, blob)).color).toBe(AUTO_ITEM_COLORS[6])
  })

  it('a session deleted on the dashboard (stamped, no server row) is never re-created by a colour change; it stays here', async () => {
    await saveSession(session('s1', { uploadedAt: 1 }))
    const { result } = renderHook(() => useUpdateSessionColor(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: 's1', color: AUTO_ITEM_COLORS[2], cloudSync: true })
    })
    expect(net.rows.has('s1')).toBe(false)
    expect(net.log.filter((op) => op.startsWith('upsert'))).toEqual([])
    const [local] = await getSessions()
    expect(local).toMatchObject({ id: 's1', color: AUTO_ITEM_COLORS[2] })
    // nothing left to retry: the server deliberately does not have it
    expect(local.uploadPending).toBeUndefined()
  })

  it('an upload that could not happen (no key) leaves the session marked for the sync to retry', async () => {
    net.key = null
    await saveSession(session('s1'))
    const { result } = renderHook(() => useUpdateSessionColor(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: 's1', color: AUTO_ITEM_COLORS[2], cloudSync: true })
    })
    const [local] = await getSessions()
    expect(local.uploadPending).toEqual(expect.any(Number))
    expect(local.uploadedAt).toBeUndefined()
    expect(net.log).toEqual([])
  })

  it('an automatic backup cannot be recoloured: nothing written, nothing sent', async () => {
    await saveSession(session('b1', { auto: true }))
    const { result } = renderHook(() => useUpdateSessionColor(), { wrapper })
    let out: unknown
    await act(async () => {
      out = await result.current.mutateAsync({ id: 'b1', color: AUTO_ITEM_COLORS[2], cloudSync: true })
    })
    expect(out).toBeNull()
    expect((await getSessions())[0].color).toBeUndefined()
    expect(net.log).toEqual([])
  })
})
