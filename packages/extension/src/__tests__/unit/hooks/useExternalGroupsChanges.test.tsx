import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useExternalGroupsChanges } from '@/hooks/useExternalGroupsChanges'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { useUIStore } from '@/stores/uiStore'
import { consumeOwnOpenedTab, noteTabsOpenedByPopup, OWN_TAB_WINDOW_MS, resetOwnOpenedTabs } from '@/lib/ownOpenedTabs'
import { reanchorHistoryCursor } from '@/lib/undoHistory'

vi.mock('@/lib/undoHistory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/undoHistory')>()),
  reanchorHistoryCursor: vi.fn().mockResolvedValue(undefined),
}))

type Listener = (msg: unknown) => void

describe('useExternalGroupsChanges', () => {
  let listeners: Listener[]
  let qc: QueryClient
  let invalidate: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    listeners = []
    ;(globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        onMessage: {
          addListener: (l: Listener) => listeners.push(l),
          removeListener: (l: Listener) => { listeners = listeners.filter((x) => x !== l) },
        },
      },
    }
    qc = new QueryClient()
    invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined)
    vi.mocked(reanchorHistoryCursor).mockClear()
  })

  afterEach(() => {
    cleanup() // unmount while the stub still exists (the hook's cleanup reads chrome)
    delete (globalThis as { chrome?: unknown }).chrome
  })

  const mount = () =>
    renderHook(() => useExternalGroupsChanges(), {
      wrapper: ({ children }) => React.createElement(QueryClientProvider, { client: qc }, children),
    })

  it('refetches the groups query on a groups-changed message, joining (never cancelling) an in-flight fetch', () => {
    mount()
    listeners.forEach((l) => l({ type: 'TM_GROUPS_CHANGED' }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: GROUPS_QUERY_KEY }, { cancelRefetch: false })
  })

  describe('a write of another context that changed only Now Open (its live-tab mirror)', () => {
    const entry = { available: [], active: { id: '', index: 0 } }
    beforeEach(() => useUIStore.setState({ undoStack: [entry], redoStack: [entry] }))

    it('keeps the history when the writer declares it left the saved data unchanged (savedUnchanged: true)', () => {
      mount()
      listeners.forEach((l) => l({ type: 'TM_GROUPS_CHANGED', savedUnchanged: true }))
      expect(useUIStore.getState().undoStack).toHaveLength(1)
      expect(useUIStore.getState().redoStack).toHaveLength(1)
      expect(invalidate).toHaveBeenCalled() // still refetched
    })

    it('clears it for anything but exactly true (absent: an older sender, a blind write, a wipe)', () => {
      mount()
      for (const savedUnchanged of [undefined, false, 'true', 1]) {
        useUIStore.setState({ undoStack: [entry] })
        listeners.forEach((l) => l({ type: 'TM_GROUPS_CHANGED', ...(savedUnchanged === undefined ? {} : { savedUnchanged }) }))
        expect(useUIStore.getState().undoStack).toEqual([])
      }
    })

    it('a URL rule saving a tab this popup opened (it changed saved data) re-anchors on its fingerprint and keeps the history', () => {
      noteTabsOpenedByPopup([{ id: 801, url: 'https://example.com/r' }])
      mount()
      listeners.forEach((l) => l({ type: 'TM_GROUPS_CHANGED', cause: { kind: 'url-rule', tabId: 801, url: 'https://example.com/r' }, saved: 'fp-9' }))
      expect(reanchorHistoryCursor).toHaveBeenCalledWith('fp-9')
      expect(useUIStore.getState().undoStack).toHaveLength(1)
    })
  })

  it('clears the undo/redo history: a snapshot older than another context write must not be restored over it', () => {
    useUIStore.setState({ undoStack: [{ available: [], active: { id: '', index: 0 } }], redoStack: [] })
    mount()
    listeners.forEach((l) => l({ type: 'TM_GROUPS_CHANGED' }))
    expect(useUIStore.getState().undoStack).toEqual([])
  })

  describe('a URL rule saving a tab', () => {
    const entry = { available: [], active: { id: '', index: 0 } }
    beforeEach(() => {
      resetOwnOpenedTabs()
      useUIStore.setState({ undoStack: [entry], redoStack: [entry] })
    })

    it('THIS popup opened (part of its own action): the history stays, the groups are still refetched', () => {
      noteTabsOpenedByPopup([{ id: 501, url: 'https://example.com/a' }])
      mount()
      listeners.forEach((l) => l({ type: 'TM_GROUPS_CHANGED', cause: { kind: 'url-rule', tabId: 501, url: 'https://example.com/a' }, saved: 'fp-1' }))
      expect(useUIStore.getState().undoStack).toHaveLength(1)
      expect(useUIStore.getState().redoStack).toHaveLength(1)
      expect(invalidate).toHaveBeenCalledWith({ queryKey: GROUPS_QUERY_KEY }, { cancelRefetch: false })
      // the kept history's next Undo must not be refused for that save: the cursor is re-anchored on it
      expect(reanchorHistoryCursor).toHaveBeenCalledWith('fp-1')
    })

    it('the popup did NOT open (a change made elsewhere): the history is cleared', () => {
      noteTabsOpenedByPopup([{ id: 501, url: 'https://example.com/a' }])
      mount()
      listeners.forEach((l) => l({ type: 'TM_GROUPS_CHANGED', cause: { kind: 'url-rule', tabId: 777, url: 'https://example.com/a' } }))
      expect(useUIStore.getState().undoStack).toEqual([])
      expect(reanchorHistoryCursor).not.toHaveBeenCalled()
    })

    it('a malformed cause counts as a change made elsewhere', () => {
      noteTabsOpenedByPopup([{ id: 501, url: 'https://example.com/a' }])
      mount()
      listeners.forEach((l) => l({ type: 'TM_GROUPS_CHANGED', cause: { kind: 'url-rule', tabId: '501', url: 'https://example.com/a' } }))
      expect(useUIStore.getState().undoStack).toEqual([])
    })

    it('only ONCE: a second rule save of the same tab (its reload) clears the history', () => {
      noteTabsOpenedByPopup([{ id: 501, url: 'https://example.com/a' }])
      mount()
      const msg = { type: 'TM_GROUPS_CHANGED', cause: { kind: 'url-rule', tabId: 501, url: 'https://example.com/a' } }
      listeners.forEach((l) => l(msg))
      expect(useUIStore.getState().undoStack).toHaveLength(1)
      listeners.forEach((l) => l(msg))
      expect(useUIStore.getState().undoStack).toEqual([])
    })

    it('after the tab was navigated (the saved URL is another one), the history is cleared', () => {
      noteTabsOpenedByPopup([{ id: 501, url: 'https://example.com/a' }])
      mount()
      listeners.forEach((l) => l({ type: 'TM_GROUPS_CHANGED', cause: { kind: 'url-rule', tabId: 501, url: 'https://example.com/somewhere-else' } }))
      expect(useUIStore.getState().undoStack).toEqual([])
    })

    it('long after the action (a capture minutes later), the history is cleared', () => {
      vi.useFakeTimers()
      try {
        noteTabsOpenedByPopup([{ id: 501, url: 'https://example.com/a' }])
        mount()
        vi.advanceTimersByTime(OWN_TAB_WINDOW_MS + 1)
        listeners.forEach((l) => l({ type: 'TM_GROUPS_CHANGED', cause: { kind: 'url-rule', tabId: 501, url: 'https://example.com/a' } }))
        expect(useUIStore.getState().undoStack).toEqual([])
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('the own-opened-tabs registry', () => {
    beforeEach(() => resetOwnOpenedTabs())

    it('only keeps real tab ids with a URL, and compares URLs in their normal form', () => {
      noteTabsOpenedByPopup([{ id: undefined, url: 'https://a.com' }, { id: 0, url: 'https://a.com' }, { id: -3, url: 'https://a.com' }, { id: 13 }, { id: 12, url: 'https://a.com' }], 1000)
      expect(consumeOwnOpenedTab(0, 'https://a.com', 1000)).toBe(false)
      expect(consumeOwnOpenedTab(13, '', 1000)).toBe(false)
      expect(consumeOwnOpenedTab(12, 'https://a.com/', 1000 + OWN_TAB_WINDOW_MS)).toBe(true)
      expect(consumeOwnOpenedTab(12, 'https://a.com/', 1000)).toBe(false) // consumed
    })

    it('an unparsable URL compares as written; a non-string cause URL never matches', () => {
      noteTabsOpenedByPopup([{ id: 5, url: 'not a url' }, { id: 6, url: 'https://a.com' }], 0)
      expect(consumeOwnOpenedTab(5, 'not a url', 0)).toBe(true)
      expect(consumeOwnOpenedTab(6, undefined, 0)).toBe(false)
    })
  })

  it('ignores unrelated messages', () => {
    mount()
    listeners.forEach((l) => l({ type: 'CREATE_ALARM' }))
    listeners.forEach((l) => l(undefined))
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('removes its listener on unmount', () => {
    const { unmount } = mount()
    expect(listeners).toHaveLength(1)
    unmount()
    expect(listeners).toHaveLength(0)
  })
})
