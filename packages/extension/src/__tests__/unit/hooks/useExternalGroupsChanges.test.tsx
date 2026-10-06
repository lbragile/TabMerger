import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useExternalGroupsChanges } from '@/hooks/useExternalGroupsChanges'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { useUIStore } from '@/stores/uiStore'

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

  it('clears the undo/redo history: a snapshot older than another context write must not be restored over it', () => {
    useUIStore.setState({ undoStack: [{ available: [], active: { id: '', index: 0 } }], redoStack: [] })
    mount()
    listeners.forEach((l) => l({ type: 'TM_GROUPS_CHANGED' }))
    expect(useUIStore.getState().undoStack).toEqual([])
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
