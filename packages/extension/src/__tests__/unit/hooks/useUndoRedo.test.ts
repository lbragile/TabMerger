import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUndoRedo } from '@/hooks/useUndoRedo'

const { mockUseUIStore, mockUseGroups, mockSetGroupsState, mockToastInfo } = vi.hoisted(() => ({
  mockToastInfo: vi.fn(),
  mockUseUIStore: vi.fn(),
  mockUseGroups: vi.fn(),
  mockSetGroupsState: vi.fn(),
}))

vi.mock('@/lib/toast', () => ({ toast: { info: mockToastInfo } }))
const { mockSignalTour, mockTourHistory } = vi.hoisted(() => ({ mockSignalTour: vi.fn(), mockTourHistory: { value: null as unknown } }))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: Object.assign((selector: (s: object) => unknown) => mockUseUIStore(selector), {
    getState: () => ({ ...(mockUseUIStore((st: object) => st) as object), tourHistory: mockTourHistory.value, signalTour: mockSignalTour }),
  }),
}))
vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => mockUseGroups(),
  useSetGroupsState: () => mockSetGroupsState,
  useGroupsSnapshot: () => () => mockUseGroups().data,
}))

const groupsState = { available: [{ id: 'now' }], active: { id: 'now', index: 0 } }

function makeState(overrides: Partial<{ undoStack: unknown[]; redoStack: unknown[]; undo: (s: unknown) => unknown; redo: (s: unknown) => unknown; restoreHistory: (u: unknown[], r: unknown[]) => void }> = {}) {
  return {
    undoStack: [],
    redoStack: [],
    undo: vi.fn(),
    redo: vi.fn(),
    restoreHistory: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseGroups.mockReturnValue({ data: groupsState })
})

describe('useUndoRedo — canUndo/canRedo', () => {
  it('canUndo/canRedo are false when both stacks are empty', () => {
    mockUseUIStore.mockImplementation((sel) => sel(makeState()))
    const { result } = renderHook(() => useUndoRedo())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('canUndo is true when the undo stack has entries', () => {
    mockUseUIStore.mockImplementation((sel) => sel(makeState({ undoStack: [{}] })))
    const { result } = renderHook(() => useUndoRedo())
    expect(result.current.canUndo).toBe(true)
  })

  it('canRedo is true when the redo stack has entries', () => {
    mockUseUIStore.mockImplementation((sel) => sel(makeState({ redoStack: [{}] })))
    const { result } = renderHook(() => useUndoRedo())
    expect(result.current.canRedo).toBe(true)
  })
})

describe('useUndoRedo — undo()', () => {
  it('applies the previous snapshot via setGroupsState when undoFn returns one', async () => {
    const prevSnapshot = { available: [], active: { id: '', index: 0 } }
    const undoFn = vi.fn().mockReturnValue(prevSnapshot)
    mockUseUIStore.mockImplementation((sel) => sel(makeState({ undo: undoFn })))
    const { result } = renderHook(() => useUndoRedo())
    await act(async () => { await result.current.undo() })
    expect(undoFn).toHaveBeenCalledWith(groupsState)
    expect(mockSetGroupsState).toHaveBeenCalledWith(prevSnapshot, { expectedRev: (groupsState as { rev?: number }).rev })
  })

  it('does nothing when undoFn returns undefined (empty stack)', async () => {
    const undoFn = vi.fn().mockReturnValue(undefined)
    mockUseUIStore.mockImplementation((sel) => sel(makeState({ undo: undoFn })))
    const { result } = renderHook(() => useUndoRedo())
    await act(async () => { await result.current.undo() })
    expect(mockSetGroupsState).not.toHaveBeenCalled()
  })

  it('does nothing when groupsState has not loaded yet', async () => {
    mockUseGroups.mockReturnValue({ data: undefined })
    const undoFn = vi.fn()
    mockUseUIStore.mockImplementation((sel) => sel(makeState({ undo: undoFn })))
    const { result } = renderHook(() => useUndoRedo())
    await act(async () => { await result.current.undo() })
    expect(undoFn).not.toHaveBeenCalled()
    expect(mockSetGroupsState).not.toHaveBeenCalled()
  })
})

describe('useUndoRedo — lost rev race (M4)', () => {
  it('undo: puts the history entry back and shows a stable-id toast instead of silently consuming it', async () => {
    const snapshot = { available: [], active: { id: '', index: 0 } }
    const undoFn = vi.fn().mockReturnValue(snapshot)
    const restoreHistory = vi.fn()
    const undoStack = [snapshot]
    mockSetGroupsState.mockResolvedValueOnce(false)
    const state = makeState({ undo: undoFn, restoreHistory, undoStack, redoStack: [] })
    mockUseUIStore.mockImplementation((sel) => sel(state))
    const { result } = renderHook(() => useUndoRedo())
    await act(async () => { await result.current.undo() })
    expect(restoreHistory).toHaveBeenCalledWith(undoStack, [])
    expect(mockToastInfo).toHaveBeenCalledWith(expect.stringMatching(/changed/i), expect.objectContaining({ id: 'undo-conflict' }))
  })

  it('does not put the entry back when the history changed in the meantime (cleared, new change, tour start/end)', async () => {
    const snapshot = { available: [], active: { id: '', index: 0 } }
    const restoreHistory = vi.fn()
    const undoFn = vi.fn().mockReturnValue(snapshot)
    const state = makeState({ undo: undoFn, restoreHistory, undoStack: [snapshot], redoStack: [] })
    mockUseUIStore.mockImplementation((sel) => sel(state))
    mockSetGroupsState.mockImplementationOnce(async () => {
      // while the write was in flight the history was replaced by a different one
      mockUseUIStore.mockImplementation((sel) => sel(makeState({ undo: undoFn, restoreHistory, undoStack: [], redoStack: [] })))
      return false
    })
    const { result } = renderHook(() => useUndoRedo())
    await act(async () => { await result.current.undo() })
    expect(restoreHistory).not.toHaveBeenCalled()
    expect(mockToastInfo).toHaveBeenCalledWith(expect.stringMatching(/changed/i), expect.objectContaining({ id: 'undo-conflict' }))
  })

  it('does not put the entry back when the tour history began or ended during the write', async () => {
    const snapshot = { available: [], active: { id: '', index: 0 } }
    const restoreHistory = vi.fn()
    const state = makeState({ undo: vi.fn().mockReturnValue(snapshot), restoreHistory, undoStack: [snapshot], redoStack: [] })
    mockUseUIStore.mockImplementation((sel) => sel(state))
    mockSetGroupsState.mockImplementationOnce(async () => {
      mockTourHistory.value = { undoStack: [], redoStack: [] }
      return false
    })
    const { result } = renderHook(() => useUndoRedo())
    await act(async () => { await result.current.undo() })
    mockTourHistory.value = null
    expect(restoreHistory).not.toHaveBeenCalled()
    expect(mockToastInfo).toHaveBeenCalled()
  })

  it('redo: same recovery', async () => {
    const snapshot = { available: [], active: { id: '', index: 0 } }
    const redoFn = vi.fn().mockReturnValue(snapshot)
    const restoreHistory = vi.fn()
    mockSetGroupsState.mockResolvedValueOnce(false)
    const state = makeState({ redo: redoFn, restoreHistory, undoStack: [], redoStack: [snapshot] })
    mockUseUIStore.mockImplementation((sel) => sel(state))
    const { result } = renderHook(() => useUndoRedo())
    await act(async () => { await result.current.redo() })
    expect(restoreHistory).toHaveBeenCalledWith([], [snapshot])
    expect(mockToastInfo).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ id: 'undo-conflict' }))
  })

  it('tells the tour about a successful undo/redo (signalTour) and not about a refused one', async () => {
    const snapshot = { available: [], active: { id: '', index: 0 } }
    mockSetGroupsState.mockResolvedValueOnce(true)
    mockUseUIStore.mockImplementation((sel) => sel(makeState({ undo: vi.fn().mockReturnValue(snapshot) })))
    const { result } = renderHook(() => useUndoRedo())
    await act(async () => { await result.current.undo() })
    expect(mockSignalTour).toHaveBeenCalledWith('undo')
    mockSignalTour.mockClear()
    mockSetGroupsState.mockResolvedValueOnce(false)
    await act(async () => { await result.current.undo() })
    expect(mockSignalTour).not.toHaveBeenCalled()
  })

  it('during the tour practice history the snapshot is applied as a practice-only change', async () => {
    const snapshot = { available: [], active: { id: '', index: 0 } }
    mockTourHistory.value = { undoStack: [], redoStack: [] }
    mockUseUIStore.mockImplementation((sel) => sel(makeState({ undo: vi.fn().mockReturnValue(snapshot) })))
    const { result } = renderHook(() => useUndoRedo())
    await act(async () => { await result.current.undo() })
    expect(mockSetGroupsState).toHaveBeenCalledTimes(1)
    mockTourHistory.value = null
  })

  it('no recovery when the write went through', async () => {
    const snapshot = { available: [], active: { id: '', index: 0 } }
    const restoreHistory = vi.fn()
    mockSetGroupsState.mockResolvedValueOnce(true)
    mockUseUIStore.mockImplementation((sel) => sel(makeState({ undo: vi.fn().mockReturnValue(snapshot), restoreHistory })))
    const { result } = renderHook(() => useUndoRedo())
    await act(async () => { await result.current.undo() })
    expect(restoreHistory).not.toHaveBeenCalled()
    expect(mockToastInfo).not.toHaveBeenCalled()
  })
})

describe('useUndoRedo — redo()', () => {
  it('applies the next snapshot via setGroupsState when redoFn returns one', async () => {
    const nextSnapshot = { available: [], active: { id: '', index: 0 } }
    const redoFn = vi.fn().mockReturnValue(nextSnapshot)
    mockUseUIStore.mockImplementation((sel) => sel(makeState({ redo: redoFn })))
    const { result } = renderHook(() => useUndoRedo())
    await act(async () => { await result.current.redo() })
    expect(redoFn).toHaveBeenCalledWith(groupsState)
    expect(mockSetGroupsState).toHaveBeenCalledWith(nextSnapshot, { expectedRev: (groupsState as { rev?: number }).rev })
  })

  it('does nothing when redoFn returns undefined', async () => {
    const redoFn = vi.fn().mockReturnValue(undefined)
    mockUseUIStore.mockImplementation((sel) => sel(makeState({ redo: redoFn })))
    const { result } = renderHook(() => useUndoRedo())
    await act(async () => { await result.current.redo() })
    expect(mockSetGroupsState).not.toHaveBeenCalled()
  })
})
