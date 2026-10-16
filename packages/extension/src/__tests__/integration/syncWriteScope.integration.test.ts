/**
 * Real IndexedDB (fake-indexeddb) + real localDb write queue/lock + real syncEngine push, with only
 * the Supabase network edge and the encryption key faked:
 *  - a coalesced Now Open mirror pass interleaved with a saved-group mutation never loses the
 *    mutation, whichever of the two reaches the write queue first;
 *  - a bulk star of Now Open windows only never reaches the push path, and a bulk star of one saved
 *    group's window pushes that group alone.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { Session } from '@supabase/supabase-js'
import { useCurrentTabs, NOW_OPEN_SYNC_DELAY_MS } from '@/hooks/useCurrentTabs'
import { useBulkStar } from '@/hooks/useBulkActions'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { getGroupsState, saveGroupsState, updateGroupsState } from '@/lib/localDb'
import { pushPendingChanges } from '@/lib/syncEngine'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import type { Group, GroupsState } from '@/lib/types'
import { useUIStore } from '@/stores/uiStore'
import { clearDb } from './dbTestUtils'
import { fakeRemote } from './fakeSupabase'

vi.mock('@/lib/supabase', async () => {
  const m = await import('./fakeSupabase')
  return { supabase: m.fakeSupabase, isSupabaseConfigured: true }
})
vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: vi.fn(async () => 'present'),
  getDataKey: vi.fn(async () => (await import('./testEncryption')).testDataKey()),
  ENCRYPTION_MIGRATION_DONE_KEY: 'encryptionMigrationDone',
  SESSIONS_MIGRATION_DONE_KEY: 'sessionsEncryptionMigrationDone',
}))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ tier: 'free' }) }))
vi.mock('@/lib/deviceSessions', () => ({ pushDeviceSession: vi.fn() }))

const session = { user: { id: 'user-1' } } as unknown as Session

type ChromeStub = {
  tabs: { query: ReturnType<typeof vi.fn>; onUpdated: { addListener: ReturnType<typeof vi.fn> } }
  windows: Record<string, unknown>
  tabGroups?: unknown
  runtime: Record<string, unknown>
}
const chromeStub = (globalThis as unknown as { chrome: ChromeStub }).chrome
let liveTitle = 'live 0'

function liveTab(title: string): chrome.tabs.Tab {
  return { id: 10, windowId: 1, index: 0, title, url: 'https://live.example.com', pinned: false, groupId: -1 } as chrome.tabs.Tab
}

function savedGroup(id: string): Group {
  const g = createGroup(id, `name-${id}`)
  g.windows = [{ id: 0, incognito: false, focused: false, tabs: [{ id: 0, title: id, url: `https://${id}.example.com` }] }]
  return { ...g, updatedAt: 1000, pendingSync: false }
}

async function seed(...groups: Group[]): Promise<Group> {
  const nowOpen = createNowOpenGroup()
  nowOpen.windows = [{ id: 1, incognito: false, focused: false, tabs: [{ id: 10, title: 'live 0', url: 'https://live.example.com' }] }]
  await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, ...groups] } as GroupsState)
  return nowOpen
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

const nowOpenTitle = (s: GroupsState) => s.available.find((g) => g.permanent)?.windows[0]?.tabs[0]?.title

beforeEach(async () => {
  fakeRemote.reset()
  await clearDb()
  useUIStore.setState({ undoStack: [], redoStack: [] })
  liveTitle = 'live 0'
  chromeStub.windows = {
    ...chromeStub.windows,
    getAll: vi.fn(async () => [{ id: 1, type: 'normal', focused: true, incognito: false }]),
    onCreated: { addListener: vi.fn(), removeListener: vi.fn() },
  }
  chromeStub.tabGroups = { query: vi.fn(async () => []) }
  chromeStub.runtime = { ...chromeStub.runtime, id: 'test-ext-id' }
  chromeStub.tabs.query.mockImplementation(async () => [liveTab(liveTitle)])
})

afterEach(() => {
  chromeStub.tabs.query.mockReset()
  chromeStub.tabs.query.mockResolvedValue([])
})

/** Mounts the Now Open mirror, waits for its immediate pass, and returns the tab-event listener. */
async function mountMirror() {
  const { qc, wrapper } = makeWrapper()
  const view = renderHook(() => useCurrentTabs(), { wrapper })
  await waitFor(() => expect(qc.getQueryData(GROUPS_QUERY_KEY)).toBeDefined())
  const calls = chromeStub.tabs.onUpdated.addListener.mock.calls
  const onUpdated = calls[calls.length - 1][0] as () => void
  return { qc, onUpdated, ...view }
}

const rename = (id: string, name: string) =>
  updateGroupsState((s) => ({
    ...s,
    available: s.available.map((g) => (g.id === id ? { ...g, name, updatedAt: Date.now(), pendingSync: true } : g)),
  }))

describe('Now Open mirror pass interleaved with a saved-group mutation (real IndexedDB)', () => {
  it('a mutation stored while the mirror pass is querying the browser survives the pass', async () => {
    await seed(savedGroup('g1'))
    const { onUpdated, unmount } = await mountMirror()

    // Hold the mirror pass's browser query open: the pass has started but not yet written
    let release!: () => void
    chromeStub.tabs.query.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve([liveTab('live 1')])
    }))
    onUpdated()
    await waitFor(() => expect(release).toBeTypeOf('function'), { timeout: NOW_OPEN_SYNC_DELAY_MS * 10 })

    await rename('g1', 'Dropped') // the user's write lands while the pass waits
    await act(async () => { release() })

    await waitFor(async () => expect(nowOpenTitle(await getGroupsState())).toBe('live 1'))
    const g1 = (await getGroupsState()).available.find((g) => g.id === 'g1')
    expect(g1?.name).toBe('Dropped')
    expect(g1?.pendingSync).toBe(true)
    unmount()
  })

  it('a burst of tab events racing with a mutation: both the mutation and the latest live state are stored', async () => {
    await seed(savedGroup('g1'))
    const { qc, onUpdated, unmount } = await mountMirror()

    const writes: Promise<unknown>[] = []
    for (let i = 1; i <= 8; i++) {
      liveTitle = `live ${i}`
      onUpdated()
      if (i === 4) writes.push(rename('g1', 'Dropped'))
      await new Promise((r) => setTimeout(r, 20))
    }
    await Promise.all(writes)

    await waitFor(async () => expect(nowOpenTitle(await getGroupsState())).toBe('live 8'))
    const stored = await getGroupsState()
    expect(stored.available.find((g) => g.id === 'g1')?.name).toBe('Dropped')
    // The cache follows the store: the mirror pass sets it from the stored result, mutation included
    await waitFor(() => {
      const cached = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)
      expect(cached && nowOpenTitle(cached)).toBe('live 8')
      expect(cached?.available.find((g) => g.id === 'g1')?.name).toBe('Dropped')
    })
    unmount()
  })
})

describe('bulk star write scope reaches the push path (real IndexedDB + real push)', () => {
  async function bulkStar(ids: string[]) {
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, await getGroupsState())
    const { result } = renderHook(() => useBulkStar(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ items: ids.map((id) => ({ type: 'window' as const, id })), starred: true })
    })
  }

  it('starring only a Now Open window is no undo step and pushes nothing', async () => {
    const nowOpen = await seed(savedGroup('g1'))
    await bulkStar(['window-0-0'])

    expect((await getGroupsState()).available[0].windows[0].starred).toBe(true)
    expect(useUIStore.getState().undoStack).toHaveLength(0)
    await pushPendingChanges(session)
    expect(fakeRemote.upserts.some((r) => r.id === nowOpen.id)).toBe(false)
    expect(fakeRemote.upserts.some((r) => r.id === 'g1')).toBe(false)
  })

  it('starring a window of one saved group pushes that group only', async () => {
    await seed(savedGroup('g1'), savedGroup('g2'))
    await bulkStar(['window-1-0'])

    const stored = await getGroupsState()
    expect(stored.available.find((g) => g.id === 'g2')).toMatchObject({ updatedAt: 1000, pendingSync: false })
    await pushPendingChanges(session)
    expect(fakeRemote.upserts.map((r) => r.id)).toEqual(['g1'])
  })
})
