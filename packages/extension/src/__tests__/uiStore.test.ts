import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '@/stores/uiStore'

const reset = () =>
  useUIStore.setState({
    modal: { type: null },
    activeGroupIndex: 0,
    searchFilter: '',
    renameTarget: null,
    undoStack: [],
    redoStack: [],
    selectionMode: false,
    selectedItems: [],
  })

beforeEach(reset)

describe('modal', () => {
  it('starts closed', () => {
    expect(useUIStore.getState().modal.type).toBeNull()
  })

  it('opens with type and data', () => {
    useUIStore.getState().openModal('addGroup', { foo: 'bar' })
    const { modal } = useUIStore.getState()
    expect(modal.type).toBe('addGroup')
    expect(modal.data).toEqual({ foo: 'bar' })
  })

  it('closes', () => {
    useUIStore.getState().openModal('settings')
    useUIStore.getState().closeModal()
    expect(useUIStore.getState().modal.type).toBeNull()
  })
})

describe('activeGroupIndex', () => {
  it('starts at 0', () => {
    expect(useUIStore.getState().activeGroupIndex).toBe(0)
  })

  it('updates', () => {
    useUIStore.getState().setActiveGroupIndex(3)
    expect(useUIStore.getState().activeGroupIndex).toBe(3)
  })
})

describe('searchFilter', () => {
  it('starts empty', () => {
    expect(useUIStore.getState().searchFilter).toBe('')
  })

  it('updates', () => {
    useUIStore.getState().setSearchFilter('github')
    expect(useUIStore.getState().searchFilter).toBe('github')
  })
})

describe('selection mode', () => {
  it('selectionMode starts false', () => {
    expect(useUIStore.getState().selectionMode).toBe(false)
  })

  it('selectedItems starts empty', () => {
    expect(useUIStore.getState().selectedItems).toEqual([])
  })

  it('enterSelectionMode sets selectionMode to true', () => {
    useUIStore.getState().enterSelectionMode()
    expect(useUIStore.getState().selectionMode).toBe(true)
  })

  it('exitSelectionMode sets selectionMode to false and clears selectedItems', () => {
    useUIStore.getState().enterSelectionMode()
    useUIStore.getState().toggleSelection({ type: 'tab', id: 'a' })
    useUIStore.getState().exitSelectionMode()
    expect(useUIStore.getState().selectionMode).toBe(false)
    expect(useUIStore.getState().selectedItems).toEqual([])
  })

  it('toggleSelectionMode flips the value from false to true', () => {
    expect(useUIStore.getState().selectionMode).toBe(false)
    useUIStore.getState().toggleSelectionMode()
    expect(useUIStore.getState().selectionMode).toBe(true)
  })

  it('toggleSelectionMode flips the value from true to false', () => {
    useUIStore.getState().enterSelectionMode()
    useUIStore.getState().toggleSelectionMode()
    expect(useUIStore.getState().selectionMode).toBe(false)
  })

  it('toggleSelection adds an item', () => {
    useUIStore.getState().toggleSelection({ type: 'tab', id: 'a' })
    expect(useUIStore.getState().selectedItems).toEqual([{ type: 'tab', id: 'a' }])
  })

  it('toggleSelection removes an already-selected item (toggle off)', () => {
    useUIStore.getState().toggleSelection({ type: 'tab', id: 'a' })
    useUIStore.getState().toggleSelection({ type: 'tab', id: 'a' })
    expect(useUIStore.getState().selectedItems).toEqual([])
  })

  it('selecting a different type clears existing items', () => {
    useUIStore.getState().toggleSelection({ type: 'tab', id: 'tab-1' })
    useUIStore.getState().toggleSelection({ type: 'group', id: 'group-1' })
    const { selectedItems } = useUIStore.getState()
    expect(selectedItems).toHaveLength(1)
    expect(selectedItems[0]).toEqual({ type: 'group', id: 'group-1' })
  })

  it('clearSelection empties selectedItems', () => {
    useUIStore.getState().toggleSelection({ type: 'tab', id: 'a' })
    useUIStore.getState().clearSelection()
    expect(useUIStore.getState().selectedItems).toEqual([])
  })
})

describe('undo/redo stack', () => {
  const fakeState = { groups: [] } as any

  it('pushUndo adds to stack and clears redo', () => {
    useUIStore.getState().pushUndo(fakeState)
    expect(useUIStore.getState().undoStack).toHaveLength(1)
    expect(useUIStore.getState().redoStack).toHaveLength(0)
  })

  it('undo pops from stack and pushes to redo', () => {
    useUIStore.getState().pushUndo(fakeState)
    const popped = useUIStore.getState().undo()
    expect(popped).toBe(fakeState)
    expect(useUIStore.getState().undoStack).toHaveLength(0)
    expect(useUIStore.getState().redoStack).toHaveLength(1)
  })

  it('redo pops from redo and pushes back to undo', () => {
    useUIStore.getState().pushUndo(fakeState)
    useUIStore.getState().undo()
    const redone = useUIStore.getState().redo()
    expect(redone).toBe(fakeState)
    expect(useUIStore.getState().redoStack).toHaveLength(0)
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('undo returns undefined when stack is empty', () => {
    expect(useUIStore.getState().undo()).toBeUndefined()
  })

  it('redo returns undefined when stack is empty', () => {
    expect(useUIStore.getState().redo()).toBeUndefined()
  })

  it('caps undo stack at 10 items', () => {
    for (let i = 0; i < 12; i++) useUIStore.getState().pushUndo(fakeState)
    expect(useUIStore.getState().undoStack).toHaveLength(10)
  })

  it('clearHistory resets both stacks', () => {
    useUIStore.getState().pushUndo(fakeState)
    useUIStore.getState().clearHistory()
    expect(useUIStore.getState().undoStack).toHaveLength(0)
    expect(useUIStore.getState().redoStack).toHaveLength(0)
  })
})
