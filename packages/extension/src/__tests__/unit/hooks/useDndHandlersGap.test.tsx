/**
 * useDndHandlersGap.test.tsx — the collapsed-source drag model in the commit hook.
 *
 * While a native HTML5 drag has collapsed its source row (`onSourceCollapse`):
 *  - `gap` starts at the source's own slot (later siblings shift), then follows the
 *    `tmInsertion` carried by the winning collision (`onDragMove`)
 *  - `onDragEnd` commits where the GAP is (`commitOverId`), not against `over`;
 *    releasing into its own slot is a no-op; with no final target it uses the last gap
 *  - drags that never collapsed (keyboard) ignore insertions entirely
 *  - the query update notifies observers SYNCHRONOUSLY (no setTimeout(0) hop), so
 *    the sensor's `flushSync` paints the new order in the drop frame
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider, QueryObserver, notifyManager } from '@tanstack/react-query';
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/core';
import { useDndHandlers } from '@/hooks/useDndHandlers';
import { useUIStore } from '@/stores/uiStore';
import { saveGroupsState } from '@/lib/localDb';
import type { DndInsertion } from '@/lib/dndInsertion';
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types';

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({})
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

const tab = (title: string): Tab => ({ id: 0, title, url: `https://example.com/${title}` });
const win = (tabs: Tab[]): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false });
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({
  id,
  name: id,
  color: 'rgba(0,0,0,1)',
  updatedAt: 0,
  windows,
  permanent: false,
  ...over
});

function state(): GroupsState {
  const available = [
    group('now', [], { permanent: true }),
    group('work', [win([tab('a1'), tab('a2'), tab('a3')]), win([tab('b1')])])
  ];
  return { active: { id: 'now', index: 0 }, available };
}

const W0 = ['work::w0::t0', 'work::w0::t1', 'work::w0::t2'];
const activeA1 = {
  id: 'work::w0::t0',
  data: { current: { type: 'tab', groupId: 'work', windowId: 'work::w0', sortable: { index: 0, items: W0 } } }
};

function insertion(over: Partial<DndInsertion>): DndInsertion {
  return {
    type: 'tab',
    containerKey: 'work::w0',
    index: 0,
    sameContainer: true,
    shiftIds: [],
    commitOverId: null,
    ...over
  };
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['groups'], state());
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  const { result } = renderHook(() => useDndHandlers(), { wrapper });
  return { qc, result };
}

const tabsOf = (qc: QueryClient, wi: number) =>
  qc.getQueryData<GroupsState>(['groups'])!.available[1].windows[wi].tabs.map((t) => t.title);

function start(result: ReturnType<typeof setup>['result'], collapse = true) {
  act(() => {
    result.current.onDragStart({ active: activeA1 } as unknown as DragStartEvent);
  });
  if (collapse) {
    act(() => {
      result.current.onSourceCollapse(24);
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({ undoStack: [], redoStack: [], selectedItems: [], activeGroupIndex: 1 });
});

describe('useDndHandlers — collapsed-source gap', () => {
  it('no gap before the source collapses; on collapse the gap opens at its own slot (later siblings shift)', () => {
    const { result } = setup();
    start(result, false);
    expect(result.current.gap).toBeNull();
    act(() => {
      result.current.onSourceCollapse(24);
    });
    expect(result.current.gap?.height).toBe(24);
    expect([...(result.current.gap?.shiftIds ?? [])]).toEqual(['work::w0::t1', 'work::w0::t2']);
  });

  it('ignores a collapse with no active drag or a non-positive height', () => {
    const { result } = setup();
    act(() => {
      result.current.onSourceCollapse(24);
    });
    expect(result.current.gap).toBeNull();
    start(result, false);
    act(() => {
      result.current.onSourceCollapse(0);
    });
    expect(result.current.gap).toBeNull();
  });

  it('onDragMove: the gap follows the winning collision\'s insertion; a non-insertion target closes every list; no collisions keeps it', () => {
    const { result } = setup();
    start(result);
    act(() => {
      result.current.onDragMove({
        active: activeA1,
        collisions: [{ id: 'work::w0::t2', data: { tmInsertion: insertion({ index: 1, shiftIds: ['work::w0::t2'] }) } }]
      } as unknown as DragMoveEvent);
    });
    expect([...result.current.gap!.shiftIds]).toEqual(['work::w0::t2']);

    act(() => {
      result.current.onDragMove({ active: activeA1, collisions: [] } as unknown as DragMoveEvent);
    });
    expect([...result.current.gap!.shiftIds]).toEqual(['work::w0::t2']);

    act(() => {
      result.current.onDragMove({ active: activeA1, collisions: [{ id: 'play' }] } as unknown as DragMoveEvent);
    });
    expect(result.current.gap!.shiftIds.size).toBe(0);
  });

  it('onDragMove is ignored for drags that never collapsed (keyboard)', () => {
    const { result } = setup();
    start(result, false);
    act(() => {
      result.current.onDragMove({
        active: activeA1,
        collisions: [{ id: 'x', data: { tmInsertion: insertion({ shiftIds: ['work::w0::t1'] }) } }]
      } as unknown as DragMoveEvent);
    });
    expect(result.current.gap).toBeNull();
  });
});

describe('useDndHandlers — commit where the gap is', () => {
  it('commits to insertion.commitOverId, NOT to `over`, and clears the gap', async () => {
    const { qc, result } = setup();
    start(result);
    await act(async () => {
      await result.current.onDragEnd({
        active: activeA1,
        over: { id: 'work::w0::t2', data: { current: { type: 'tab' } } },
        collisions: [{ id: 'work::w0::t2', data: { tmInsertion: insertion({ index: 1, commitOverId: 'work::w0::t1' }) } }]
      } as unknown as DragEndEvent);
    });
    expect(tabsOf(qc, 0)).toEqual(['a2', 'a1', 'a3']); // arrayMove(0, 1) — the gap, not over=t2
    expect(saveGroupsState).toHaveBeenCalledTimes(1);
    expect(result.current.gap).toBeNull();
    expect(result.current.active).toBeNull();
  });

  it('releasing back into its own slot is a no-op', async () => {
    const { qc, result } = setup();
    start(result);
    await act(async () => {
      await result.current.onDragEnd({
        active: activeA1,
        over: { id: 'work::w0::t1', data: { current: { type: 'tab' } } },
        collisions: [{ id: 'work::w0::t1', data: { tmInsertion: insertion({ commitOverId: 'work::w0::t0' }) } }]
      } as unknown as DragEndEvent);
    });
    expect(tabsOf(qc, 0)).toEqual(['a1', 'a2', 'a3']);
    expect(saveGroupsState).not.toHaveBeenCalled();
    expect(result.current.gap).toBeNull();
  });

  it('foreign list append commits via the WINDOW id', async () => {
    const { qc, result } = setup();
    start(result);
    await act(async () => {
      await result.current.onDragEnd({
        active: activeA1,
        over: { id: 'work::w1', data: { current: { type: 'window' } } },
        collisions: [
          {
            id: 'work::w1',
            data: { tmInsertion: insertion({ containerKey: 'work::w1', sameContainer: false, index: 1, commitOverId: 'work::w1' }) }
          }
        ]
      } as unknown as DragEndEvent);
    });
    expect(tabsOf(qc, 0)).toEqual(['a2', 'a3']);
    expect(tabsOf(qc, 1)).toEqual(['b1', 'a1']);
  });

  it('with NO final target (over null, no collisions) it commits to the last gap the user saw', async () => {
    const { qc, result } = setup();
    start(result);
    act(() => {
      result.current.onDragMove({
        active: activeA1,
        collisions: [{ id: 'work::w0::t2', data: { tmInsertion: insertion({ index: 2, commitOverId: 'work::w0::t2' }) } }]
      } as unknown as DragMoveEvent);
    });
    await act(async () => {
      await result.current.onDragEnd({ active: activeA1, over: null, collisions: [] } as unknown as DragEndEvent);
    });
    expect(tabsOf(qc, 0)).toEqual(['a2', 'a3', 'a1']);
  });

  it('a drag that never collapsed ignores insertions and commits against `over` as before', async () => {
    const { qc, result } = setup();
    start(result, false);
    await act(async () => {
      await result.current.onDragEnd({
        active: activeA1,
        over: { id: 'work::w0::t2', data: { current: { type: 'tab' } } },
        collisions: [{ id: 'work::w0::t2', data: { tmInsertion: insertion({ commitOverId: 'work::w0::t1' }) } }]
      } as unknown as DragEndEvent);
    });
    expect(tabsOf(qc, 0)).toEqual(['a2', 'a3', 'a1']);
  });

  it('notifies query observers SYNCHRONOUSLY on commit, then restores TanStack\'s deferred scheduler', () => {
    const { qc, result } = setup();
    start(result);
    // Subscribe exactly like `useBaseQuery` does: `notifyManager.batchCalls(onStoreChange)`.
    // (QueryCache.subscribe listeners are always synchronous — they can't show the hop.)
    const observer = new QueryObserver(qc, { queryKey: ['groups'], enabled: false, staleTime: Infinity });
    const onStoreChange = vi.fn();
    const unsubscribe = observer.subscribe(notifyManager.batchCalls(onStoreChange));
    act(() => {
      void result.current.onDragEnd({
        active: activeA1,
        over: { id: 'work::w0::t2', data: { current: { type: 'tab' } } },
        collisions: [{ id: 'work::w0::t2', data: { tmInsertion: insertion({ commitOverId: 'work::w0::t2' }) } }]
      } as unknown as DragEndEvent);
    });
    expect(onStoreChange).toHaveBeenCalled(); // no setTimeout(0) hop for the drop commit

    onStoreChange.mockClear();
    qc.setQueryData(['groups'], state());
    expect(onStoreChange).not.toHaveBeenCalled(); // default deferred scheduler is back
    unsubscribe();
  });
});
