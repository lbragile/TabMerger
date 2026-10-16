import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/localDb', () => ({ updateGroupsState: vi.fn(), setSetting: vi.fn().mockResolvedValue(undefined) }))
import {
  asOneHistoryStep,
  carryHistoryCursor,
  changedOutsideHistory,
  forgetHistoryCursor,
  noteHistoryCursor,
  reanchorHistoryCursor,
  recordStep,
  savedDataChanged
} from '@/lib/undoHistory'
import { savedDataFingerprint } from '@/lib/savedData'
import { updateGroupsState } from '@/lib/localDb'
import { historyEntryEffect } from '@/lib/undoLiveTabs'
import { useUIStore } from '@/stores/uiStore'
import type { Group, GroupsState } from '@/lib/types'

const group = (id: string, over: Partial<Group> = {}): Group => ({
  id,
  name: id,
  color: 'rgba(0,0,0,1)',
  updatedAt: 1,
  windows: [{ id: 0, incognito: false, focused: false, tabs: [{ id: 0, title: id, url: `https://example.com/${id}` }] }],
  ...over
})
const state = (available: Group[]): GroupsState => ({ active: { id: available[0]?.id ?? '', index: 0 }, available })
const nowOpen = (over: Partial<Group> = {}) => group('now', { permanent: true, ...over })

describe('savedDataChanged — the one rule for "this write is an undo step"', () => {
  it('the same object is no change', () => {
    const s = state([nowOpen(), group('a')])
    expect(savedDataChanged(s, s)).toBe(false)
  })

  it('a new state with identical saved groups (references kept) is no change', () => {
    const s = state([nowOpen(), group('a')])
    expect(savedDataChanged(s, { ...s, available: [...s.available] })).toBe(false)
  })

  it('a content change in a saved group is a change', () => {
    const s = state([nowOpen(), group('a')])
    const next = state([s.available[0], { ...s.available[1], name: 'renamed' }])
    expect(savedDataChanged(s, next)).toBe(true)
  })

  it('a group added, removed or reordered is a change', () => {
    const s = state([nowOpen(), group('a'), group('b')])
    expect(savedDataChanged(s, state([...s.available, group('c')]))).toBe(true)
    expect(savedDataChanged(s, state(s.available.slice(0, 2)))).toBe(true)
    expect(savedDataChanged(s, state([s.available[0], s.available[2], s.available[1]]))).toBe(true)
  })

  it('a Now Open-only change is no change (Now Open is never restored from history)', () => {
    const s = state([nowOpen(), group('a')])
    const next = state([nowOpen({ windows: [] }), s.available[1]])
    expect(savedDataChanged(s, next)).toBe(false)
  })

  it('sync bookkeeping and the derived info line alone are no change', () => {
    const s = state([nowOpen(), group('a')])
    const restamped = { ...s.available[1], updatedAt: 99, pendingSync: true, positionDirty: true, remoteUpdatedAt: '2026-10-15', info: '1 tab' }
    expect(savedDataChanged(s, state([s.available[0], restamped]))).toBe(false)
  })

  it('tolerates a state with no available list', () => {
    const broken = { active: { id: '', index: 0 } } as unknown as GroupsState
    expect(savedDataChanged(broken, state([nowOpen()]))).toBe(false)
    expect(savedDataChanged(broken, state([nowOpen(), group('a')]))).toBe(true)
  })
})

describe('recordStep, the cursor and asOneHistoryStep', () => {
  beforeEach(() => {
    forgetHistoryCursor()
    useUIStore.setState({ undoStack: [], redoStack: [], tourHistory: null })
  })
  const push = (s: GroupsState) => useUIStore.getState().pushUndo(s)
  const a0 = state([nowOpen(), group('a')])
  const a1 = state([nowOpen(), group('a', { name: 'one' })])
  const a2 = state([nowOpen(), group('a', { name: 'two' })])

  it('pushes the base once the saved data changed, and tags the entry with the effect', () => {
    const effect = { kind: 'close' as const, tabs: [{ tabId: 9, url: 'https://example.com/x' }] }
    recordStep({ push, effect: () => effect })(a1, a0)
    expect(useUIStore.getState().undoStack).toEqual([a0])
    expect(historyEntryEffect(useUIStore.getState().undoStack[0])).toBe(effect)
  })

  it('records nothing for skip or for a write that changed no saved data, but moves the cursor', () => {
    recordStep({ push, skip: true })(a1, a0)
    recordStep({ push })(a1, a1)
    expect(useUIStore.getState().undoStack).toHaveLength(0)
    expect(changedOutsideHistory(a1)).toBe(false)
    expect(changedOutsideHistory(a2)).toBe(true)
  })

  it('an action whose base the history has not seen (a foreign write) drops the older entries first (S1)', () => {
    recordStep({ push })(a1, a0) // cursor = a1
    const foreign = state([nowOpen(), group('a', { name: 'one' }), group('f')])
    recordStep({ push })({ ...foreign, available: [...foreign.available, group('b')] }, foreign)
    expect(useUIStore.getState().undoStack).toEqual([foreign]) // the a0 entry (which predates f) is gone
  })

  it('a Now Open or practice-group difference between cursor and base is not foreign', () => {
    recordStep({ push })(a1, a0)
    const base = state([nowOpen({ windows: [] }), group('a', { name: 'one' }), group('p', { tourDemo: true })])
    recordStep({ push })(state([nowOpen(), group('a', { name: 'two' })]), base)
    expect(useUIStore.getState().undoStack).toHaveLength(2)
  })

  it('revertsLastStep removes the top entry when the result is its saved data', () => {
    recordStep({ push })(a1, a0)
    recordStep({ push, revertsLastStep: true })(a0, a1)
    expect(useUIStore.getState().undoStack).toHaveLength(0)
  })

  it('carryHistoryCursor follows a maintenance write only from the cursor', () => {
    noteHistoryCursor(a0)
    carryHistoryCursor(a1, a0)
    expect(changedOutsideHistory(a1)).toBe(false)
    carryHistoryCursor(a2, a0) // the cursor is no longer a0: not carried
    expect(changedOutsideHistory(a2)).toBe(true)
  })

  const storedAt = (s: GroupsState, rev: number) => {
    const stored = { ...s, rev }
    vi.mocked(updateGroupsState).mockImplementationOnce(async (fn) => {
      fn(stored, { pendingDeletes: new Set(), signedInUserId: null })
      return stored
    })
    return stored
  }

  it('reanchorHistoryCursor re-anchors when the store holds exactly the saved data the rule write left, whatever Now Open did since', async () => {
    noteHistoryCursor(a0)
    // the stored state: the rule's saved data, then a Now Open write (a newer rev, other live tabs)
    const stored = storedAt({ ...a2, available: [nowOpen({ windows: [] }), ...a2.available.slice(1)] }, 9)
    await reanchorHistoryCursor(savedDataFingerprint(a2))
    expect(changedOutsideHistory(stored)).toBe(false)
  })

  it('reanchorHistoryCursor leaves the cursor when the saved data changed after the rule write', async () => {
    noteHistoryCursor(a0)
    const stored = storedAt(a1, 8)
    await reanchorHistoryCursor(savedDataFingerprint(a2))
    expect(changedOutsideHistory(stored)).toBe(true)
  })

  it('reanchorHistoryCursor does nothing for a missing or malformed fingerprint, and swallows a failed read', async () => {
    vi.mocked(updateGroupsState).mockClear()
    await reanchorHistoryCursor(undefined)
    await reanchorHistoryCursor(12)
    await reanchorHistoryCursor('')
    expect(updateGroupsState).not.toHaveBeenCalled()
    vi.mocked(updateGroupsState).mockRejectedValueOnce(new Error('closed'))
    await expect(reanchorHistoryCursor('x')).resolves.toBeUndefined()
  })

  it('asOneHistoryStep folds every later write into the first entry; the first effect is kept, a later one fills an empty slot', async () => {
    const effect = { kind: 'close' as const, tabs: [{ tabId: 9, url: 'https://example.com/x' }] }
    const base = structuredClone(a0) // (an entry no earlier test tagged: effects are keyed by the entry object)
    await asOneHistoryStep(async () => {
      recordStep({ push })(a1, base)
      recordStep({ push, effect: () => effect })(a2, a1)
    })
    expect(useUIStore.getState().undoStack).toEqual([a0])
    expect(historyEntryEffect(useUIStore.getState().undoStack[0])).toBe(effect)
  })

  it('asOneHistoryStep starts a new entry when something else became the top meanwhile', async () => {
    await asOneHistoryStep(async () => {
      recordStep({ push })(a1, a0)
      useUIStore.getState().pushUndo(a1) // another action's step
      recordStep({ push })(a2, a1)
    })
    expect(useUIStore.getState().undoStack).toHaveLength(3)
  })

  it('a hook that throws clears the history (it would be out of step with the data) and rethrows', () => {
    useUIStore.setState({ undoStack: [a0] })
    expect(() => recordStep({ push: () => { throw new Error('boom') } })(a1, a0)).toThrow('boom')
    expect(useUIStore.getState().undoStack).toHaveLength(0)
  })
})

describe('savedDataFingerprint', () => {
  const s = (...saved: Group[]) => state([nowOpen(), ...saved])
  it('is the same for states that differ only in Now Open, bookkeeping, info or practice groups', () => {
    const base = s(group('a'), group('b'))
    expect(savedDataFingerprint({ ...base, available: [nowOpen({ windows: [] }), ...base.available.slice(1)] })).toBe(savedDataFingerprint(base))
    expect(savedDataFingerprint(s(group('a', { updatedAt: 9, pendingSync: true, remoteUpdatedAt: 'S', positionDirty: true, info: 'x' }), group('b')))).toBe(savedDataFingerprint(base))
    expect(savedDataFingerprint(s(group('a'), group('p', { tourDemo: true }), group('b')))).toBe(savedDataFingerprint(base))
  })
  it('changes with the content or the order of the saved groups', () => {
    const base = savedDataFingerprint(s(group('a'), group('b')))
    expect(savedDataFingerprint(s(group('a', { name: 'renamed' }), group('b')))).not.toBe(base)
    expect(savedDataFingerprint(s(group('b'), group('a')))).not.toBe(base)
    expect(savedDataFingerprint(s(group('a')))).not.toBe(base)
  })
})
