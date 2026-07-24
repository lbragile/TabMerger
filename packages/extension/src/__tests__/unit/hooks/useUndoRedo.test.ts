import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUndoRedo } from '@/hooks/useUndoRedo'

const { mockUseUIStore, mockUseGroups, mockSetGroupsState } = vi.hoisted(() => ({
  mockUseUIStore: vi.fn(),
  mockUseGroups: vi.fn(),
  mockSetGroupsState: vi.fn(),
}))

vi.mock('@/stores/uiStore', () => ({ useUIStore: (selector: (s: object) => unknown) => mockUseUIStore(selector) }))
vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => mockUseGroups(),
  useSetGroupsState: () => mockSetGroupsState,
}))

const groupsState = { available: [{ id: 'now' }], active: { id: 'now', index: 0 } }

function makeState(overrides: Partial<{ undoStack: unknown[]; redoStack: unknown[]; undo: (s: unknown) => unknown; redo: (s: unknown) => unknown }> = {}) {
  return {
    undoStack: [],
    redoStack: [],
    undo: vi.fn(),
    redo: vi.fn(),
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
    expect(mockSetGroupsState).toHaveBeenCalledWith(prevSnapshot)
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

describe('useUndoRedo — redo()', () => {
  it('applies the next snapshot via setGroupsState when redoFn returns one', async () => {
    const nextSnapshot = { available: [], active: { id: '', index: 0 } }
    const redoFn = vi.fn().mockReturnValue(nextSnapshot)
    mockUseUIStore.mockImplementation((sel) => sel(makeState({ redo: redoFn })))
    const { result } = renderHook(() => useUndoRedo())
    await act(async () => { await result.current.redo() })
    expect(redoFn).toHaveBeenCalledWith(groupsState)
    expect(mockSetGroupsState).toHaveBeenCalledWith(nextSnapshot)
  })

  it('does nothing when redoFn returns undefined', async () => {
    const redoFn = vi.fn().mockReturnValue(undefined)
    mockUseUIStore.mockImplementation((sel) => sel(makeState({ redo: redoFn })))
    const { result } = renderHook(() => useUndoRedo())
    await act(async () => { await result.current.redo() })
    expect(mockSetGroupsState).not.toHaveBeenCalled()
  })
})
