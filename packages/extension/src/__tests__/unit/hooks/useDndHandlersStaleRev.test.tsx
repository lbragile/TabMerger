/**
 * Optimistic concurrency on the drop (sync-conflict-auditor N4): the drop's blind write carries
 * the rev of the cache state it was derived from. When another write landed since (service
 * worker, sync), the write is refused and the move is re-derived from a FRESH read inside the
 * groups lock instead of clobbering that write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useDndHandlers, DND_SAVE_FAILED_TEXT } from '@/hooks/useDndHandlers'
import { useUIStore } from '@/stores/uiStore'
import { saveGroupsState, updateGroupsState } from '@/lib/localDb'
import { clearDndDragLive } from '@/lib/dndMultiDrag'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn(),
  updateGroupsState: vi.fn(),
  getGroupsState: vi.fn(),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({})
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

const save = saveGroupsState as unknown as ReturnType<typeof vi.fn>
const update = updateGroupsState as unknown as ReturnType<typeof vi.fn>

const tab = (title: string): Tab => ({ id: 0, title, url: `https://example.com/${title}` })
const win = (tabs: Tab[]): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false })
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({
  id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 1, windows, ...over
})
const seed = (): GroupsState => ({
  active: { id: 'now', index: 0 },
  rev: 5,
  available: [
    group('now', [], { permanent: true }),
    group('work', [win([tab('a1'), tab('a2')])]),
    group('play', [win([tab('p1')])])
  ]
})
const stale = () => Object.assign(new Error('stale'), { name: 'StaleGroupsError' })
const titles = (g?: Group) => g?.windows.flatMap((w) => w.tabs.map((t) => t.title))
const liveRegionText = () => document.getElementById('tm-dnd-live-region')?.textContent ?? ''

function drop() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['groups'], seed())
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useDndHandlers(), { wrapper })
  act(() => {
    result.current.onDragStart({ active: { id: 'work::w0::t0', data: { current: undefined } }, activatorEvent: new MouseEvent('mousedown') } as unknown as DragStartEvent)
  })
  return {
    qc,
    run: () =>
      act(async () => {
        await result.current.onDragEnd({
          active: { id: 'work::w0::t0', data: { current: undefined } },
          over: { id: 'play', data: { current: { type: 'group' } } }
        } as unknown as DragEndEvent)
      })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearDndDragLive()
  document.body.innerHTML = ''
  vi.spyOn(console, 'error').mockImplementation(() => {})
  useUIStore.setState({ undoStack: [], redoStack: [], selectedItems: [], selectionMode: false, activeGroupIndex: 1 })
})

describe('drop commit with a stale base rev', () => {
  it('passes the rev of the base cache state as expectedRev, and the cache follows the stored rev', async () => {
    save.mockResolvedValue(6)
    const { qc, run } = drop()
    await run()
    expect(save).toHaveBeenCalledWith(expect.anything(), { expectedRev: 5 })
    expect(qc.getQueryData<GroupsState>(['groups'])?.rev).toBe(6)
  })

  it('re-derives the move on a FRESH read when the write is refused, keeping the foreign write', async () => {
    save.mockRejectedValue(stale())
    const foreign = group('foreign', [win([tab('f1')])])
    const fresh: GroupsState = { ...seed(), rev: 6, available: [...seed().available, foreign] }
    update.mockImplementation(async (fn: (s: GroupsState) => GroupsState | null) => fn(fresh) ?? fresh)
    const { qc, run } = drop()
    await run()
    expect(update).toHaveBeenCalledOnce()
    const stored = qc.getQueryData<GroupsState>(['groups'])!
    expect(stored.available.map((g) => g.id)).toEqual(['now', 'work', 'play', 'foreign'])
    expect(titles(stored.available.find((g) => g.id === 'work'))).toEqual(['a2'])
    expect(titles(stored.available.find((g) => g.id === 'play'))).toEqual(['p1', 'a1'])
    expect(liveRegionText()).not.toBe(DND_SAVE_FAILED_TEXT)
  })

  it('rolls back and announces the failure when the drop no longer applies to the fresh state', async () => {
    save.mockRejectedValue(stale())
    const fresh: GroupsState = { ...seed(), rev: 6, available: seed().available.filter((g) => g.id !== 'work') }
    update.mockImplementation(async (fn: (s: GroupsState) => GroupsState | null) => fn(fresh) ?? fresh)
    const { run } = drop()
    await run()
    expect(liveRegionText()).toBe(DND_SAVE_FAILED_TEXT)
  })

  it('any other write failure still takes the normal failure path (no retry)', async () => {
    save.mockRejectedValue(new Error('QuotaExceeded'))
    const { run } = drop()
    await run()
    expect(update).not.toHaveBeenCalled()
    expect(liveRegionText()).toBe(DND_SAVE_FAILED_TEXT)
  })
})
