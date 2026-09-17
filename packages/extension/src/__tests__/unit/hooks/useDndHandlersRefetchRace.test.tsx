import 'fake-indexeddb/auto'
/**
 * useDndHandlersRefetchRace.test.tsx — the drop commit vs. a groups fetch that is
 * ALREADY IN FLIGHT when the drop lands (real IndexedDB via fake-indexeddb).
 *
 * Regression guard for the `cancelQueries` the phase-1 drop used to issue before
 * committing (sync-conflict-auditor finding A1):
 *  - TanStack hands a `fetchQuery` that JOINS an in-flight fetch the raw retryer
 *    promise; `cancelQueries` (revert:true) rejects it with CancelledError, so a
 *    group/bulk mutation that joined the fetch at drop time was silently lost.
 *  - Cancelling never aborted the IDB read itself.
 * The replacement is `localDb`'s write generation: a read that overlapped a write
 * re-reads, so a fetch started before the drop resolves with the post-drop state.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useDndHandlers } from '@/hooks/useDndHandlers'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { getGroupsState, saveGroupsState } from '@/lib/localDb'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

const tab = (title: string): Tab => ({ id: 0, title, url: `https://example.com/${title}` })
const win = (tabs: Tab[]): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false })
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({
  id,
  name: id,
  color: 'rgba(0,0,0,1)',
  updatedAt: 1,
  windows,
  permanent: false,
  ...over
})

function seed(): GroupsState {
  return {
    active: { id: 'now', index: 0 },
    available: [
      group('now', [], { permanent: true }),
      group('work', [win([tab('a1'), tab('a2')])]),
      group('play', [win([tab('p1')])])
    ]
  }
}

/** group id → window → tab titles */
const shape = (s: GroupsState | undefined) =>
  Object.fromEntries((s?.available ?? []).map((g) => [g.id, g.windows.map((w) => w.tabs.map((t) => t.title))]))

/** `work::w0::t0` (a1) dropped on the Play sidebar row → a new last window in Play. */
const POST_DROP = { now: [], work: [['a2']], play: [['p1'], ['a1']] }

function setup(state: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(GROUPS_QUERY_KEY, state)
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useDndHandlers(), { wrapper })
  return { qc, result }
}

async function dropA1OnPlay(result: ReturnType<typeof setup>['result']) {
  await act(async () => {
    await result.current.onDragEnd({
      active: { id: 'work::w0::t0' },
      over: { id: 'play', data: { current: { type: 'group' } } }
    } as unknown as DragEndEvent)
  })
}

describe('drop commit vs. a groups fetch already in flight (no cancelQueries)', () => {
  it('a groups refetch ALREADY IN FLIGHT when the drop commits resolves with the POST-drop state; cache and IDB agree', async () => {
    const s = seed()
    await saveGroupsState(s)
    const { qc, result } = setup(s)
    act(() => {
      result.current.onDragStart({ active: { id: 'work::w0::t0' } } as unknown as DragStartEvent)
    })

    // e.g. `useGroups` (staleTime 0) refetching because something mounted just before release
    const inFlight = qc.fetchQuery({ queryKey: GROUPS_QUERY_KEY, queryFn: getGroupsState, staleTime: 0 })
    await dropA1OnPlay(result)

    expect(shape(await inFlight)).toEqual(POST_DROP)
    expect(shape(qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY))).toEqual(POST_DROP)
    expect(shape(await getGroupsState())).toEqual(POST_DROP)
  })

  it('a mutation that JOINED the in-flight groups fetch (useGroupsMutation pattern) is NOT rejected by the drop and builds on the post-drop state', async () => {
    const s = seed()
    await saveGroupsState(s)
    const { qc, result } = setup(s)
    act(() => {
      result.current.onDragStart({ active: { id: 'work::w0::t0' } } as unknown as DragStartEvent)
    })

    const originator = qc.fetchQuery({ queryKey: GROUPS_QUERY_KEY, queryFn: getGroupsState, staleTime: 0 })
    // Same shape as useGroupsMutation / useBulkActions: fetchQuery on the key JOINS the
    // in-flight fetch (TanStack returns the running retryer's promise).
    const joinedMutation = qc
      .fetchQuery({ queryKey: GROUPS_QUERY_KEY, queryFn: getGroupsState })
      .then(async (prev) => {
        const next: GroupsState = { ...prev, available: [...prev.available, group('added', [win([tab('n1')])])] }
        await saveGroupsState(next)
        qc.setQueryData(GROUPS_QUERY_KEY, next)
        return next
      })

    await dropA1OnPlay(result)

    await expect(joinedMutation).resolves.toBeDefined()
    await originator
    // neither the drop nor the mutation was lost
    expect(shape(await getGroupsState())).toEqual({ ...POST_DROP, added: [['n1']] })
  })
})
