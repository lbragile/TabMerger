/**
 * useDndModel.test.ts  — RED PHASE (TDD)
 *
 * Target module (does NOT exist yet — created by the DnD rework):
 *   packages/extension/src/hooks/useDndModel.ts
 *     export function buildDndModel(groupsState: GroupsState): DndModel   (pure)
 *     export function useDndModel(): DndModel                              (hook wrapper)
 *
 * CONTRACT ASSUMPTIONS (coordinate with extension-dev):
 *   DndModel = {
 *     groupIds: string[]                                    // render order, index 0 === permanent "Now Open"
 *     permanentGroupId: string
 *     groups:  Record<string, { id: string; windowIds: string[] }>
 *     windows: Record<string, { id: string; groupId: string; tabIds: string[] }>
 *     tabs:    Record<string, { id: string; windowId: string }>
 *   }
 *   All ids are STABLE SYNTHESIZED strings — never tab.id / window.id (saved items are all id:0).
 *
 * These tests MUST fail now with "Cannot find module '@/hooks/useDndModel'" (or a missing
 * export), NOT a setup error. They go green once the rework lands.
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  buildDndModel,
  legacySelectionIdToModelId,
  modelIdToLegacySelectionId,
  useDndModel
} from '@/hooks/useDndModel'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function tab(title: string): Tab {
  // Saved tabs always carry id:0 — the model must not key off this.
  return { id: 0, title, url: `https://example.com/${title}` }
}

function win(tabs: Tab[], overrides: Partial<ExtWindow> = {}): ExtWindow {
  return { id: 0, tabs, incognito: false, focused: false, ...overrides }
}

function group(id: string, windows: ExtWindow[], overrides: Partial<Group> = {}): Group {
  return { id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 0, windows, permanent: false, ...overrides }
}

/**
 * permanent "Now Open" (index 0) + 2 saved groups:
 *   saved-a: 2 windows — [3 tabs], [1 tab]
 *   saved-b: 1 window  — [0 tabs]
 */
function makeState(): GroupsState {
  const nowOpen = group('now-open', [win([{ id: 11, title: 'live-1', url: 'https://l1' }])], { permanent: true })
  const savedA = group('saved-a', [
    win([tab('a1'), tab('a2'), tab('a3')]),
    win([tab('b1')]),
  ])
  const savedB = group('saved-b', [win([])])
  return { active: { id: 'now-open', index: 0 }, available: [nowOpen, savedA, savedB] }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildDndModel', () => {
  it('1. produces group/window/tab maps with the right counts and globally-unique ids', () => {
    const model = buildDndModel(makeState())

    expect(Object.keys(model.groups)).toHaveLength(3)
    expect(Object.keys(model.windows)).toHaveLength(4) // 1 + 2 + 1
    expect(Object.keys(model.tabs)).toHaveLength(5)    // 1 + (3+1) + 0

    const allIds = [
      ...Object.keys(model.groups),
      ...Object.keys(model.windows),
      ...Object.keys(model.tabs),
    ]
    expect(new Set(allIds).size).toBe(allIds.length) // every id unique across ALL three maps

    // window counts per group, in render order
    const [permId, aId, bId] = model.groupIds
    expect(model.groups[permId].windowIds).toHaveLength(1)
    expect(model.groups[aId].windowIds).toHaveLength(2)
    expect(model.groups[bId].windowIds).toHaveLength(1)

    // tab counts per window of saved-a
    const [aw0, aw1] = model.groups[aId].windowIds
    expect(model.windows[aw0].tabIds).toHaveLength(3)
    expect(model.windows[aw1].tabIds).toHaveLength(1)
    // saved-b's single window has zero tabs
    expect(model.windows[model.groups[bId].windowIds[0]].tabIds).toHaveLength(0)
  })

  it('2. two windows with id:0 in the same group get distinct model ids; two tabs with id:0 in different windows get distinct ids', () => {
    const model = buildDndModel(makeState())
    const aId = model.groupIds[1]
    const [aw0, aw1] = model.groups[aId].windowIds

    expect(aw0).not.toBe(aw1) // both underlying windows have id:0

    const tabsW0 = model.windows[aw0].tabIds
    const tabsW1 = model.windows[aw1].tabIds
    // a tab id from window 0 and a tab id from window 1 must never collide
    for (const t0 of tabsW0) {
      for (const t1 of tabsW1) {
        expect(t0).not.toBe(t1)
      }
    }
    // and within window 0, all three id:0 tabs are distinct
    expect(new Set(tabsW0).size).toBe(3)
  })

  it('3. every window.groupId and every tab.windowId back-pointer resolves to a real parent entry', () => {
    const model = buildDndModel(makeState())

    for (const w of Object.values(model.windows)) {
      expect(model.groups[w.groupId]).toBeDefined()
      // and the parent group actually lists this window
      expect(model.groups[w.groupId].windowIds).toContain(w.id)
    }
    for (const t of Object.values(model.tabs)) {
      expect(model.windows[t.windowId]).toBeDefined()
      expect(model.windows[t.windowId].tabIds).toContain(t.id)
    }
  })

  it('4. the permanent "Now Open" group is present and identifiable (maps back to available[0] / permanent:true)', () => {
    const state = makeState()
    const model = buildDndModel(state)

    expect(model.permanentGroupId).toBeDefined()
    expect(model.groups[model.permanentGroupId]).toBeDefined()
    // render order: permanent is always first
    expect(model.groupIds[0]).toBe(model.permanentGroupId)
    // and it corresponds to state.available[0], which is permanent
    expect(state.available[0].permanent).toBe(true)
  })
})

// ─── legacy ⇄ model selection-id mapping ─────────────────────────────────────

describe('legacySelectionIdToModelId / modelIdToLegacySelectionId', () => {
  it('round-trips a tab id: legacy → model → legacy', () => {
    const model = buildDndModel(makeState())
    // saved-a (render index 1), window 0, tab 2 → 'a3'
    const tid = model.windows[model.groups[model.groupIds[1]].windowIds[0]].tabIds[2]
    expect(legacySelectionIdToModelId(model, 'tab-1-0-2')).toBe(tid)
    // model → legacy inverse
    expect(modelIdToLegacySelectionId(model, tid)).toBe('tab-1-0-2')
    expect(legacySelectionIdToModelId(model, modelIdToLegacySelectionId(model, tid)!)).toBe(tid)
  })

  it('round-trips a window id and a group id', () => {
    const model = buildDndModel(makeState())
    const wid = model.groups[model.groupIds[1]].windowIds[1]
    expect(modelIdToLegacySelectionId(model, wid)).toBe('window-1-1')
    expect(legacySelectionIdToModelId(model, 'window-1-1')).toBe(wid)

    const gid = model.groupIds[2]
    expect(modelIdToLegacySelectionId(model, gid)).toBe('group-2')
    expect(legacySelectionIdToModelId(model, 'group-2')).toBe(gid)
  })

  it('returns null for an out-of-range group index', () => {
    const model = buildDndModel(makeState())
    expect(legacySelectionIdToModelId(model, 'group-99')).toBeNull()
    expect(legacySelectionIdToModelId(model, 'tab-99-0-0')).toBeNull()
    expect(legacySelectionIdToModelId(model, 'window-42-1')).toBeNull()
  })

  it('returns null for a legacy id whose window/tab position no longer exists', () => {
    const model = buildDndModel(makeState())
    // saved-b (index 2) has exactly one window with zero tabs
    expect(legacySelectionIdToModelId(model, 'window-2-5')).toBeNull()
    expect(legacySelectionIdToModelId(model, 'tab-2-0-0')).toBeNull()
  })

  it('returns null for an unparseable legacy id', () => {
    const model = buildDndModel(makeState())
    expect(legacySelectionIdToModelId(model, 'not-a-real-id')).toBeNull()
  })

  it('returns null when asked for the legacy id of an unknown model id', () => {
    const model = buildDndModel(makeState())
    expect(modelIdToLegacySelectionId(model, 'ghost::w9::t9')).toBeNull()
  })
})

describe('useDndModel (hook wrapper)', () => {
  function wrapperFor(qc: QueryClient) {
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)
  }

  it('returns an empty model when the groups cache is unset', () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useDndModel(), { wrapper: wrapperFor(qc) })
    expect(Object.keys(result.current.groups)).toHaveLength(0)
    expect(result.current.permanentGroupId).toBe('')
  })

  it('builds the model from the ["groups"] cache and rebuilds when it changes', () => {
    const qc = new QueryClient()
    qc.setQueryData(['groups'], makeState())
    const { result } = renderHook(() => useDndModel(), { wrapper: wrapperFor(qc) })

    expect(Object.keys(result.current.groups)).toHaveLength(3)
    expect(result.current.groupIds[0]).toBe(result.current.permanentGroupId)

    act(() => {
      qc.setQueryData(['groups'], {
        active: { id: 'now-open', index: 0 },
        available: [
          { id: 'now-open', name: 'Now Open', color: 'rgba(0,0,0,1)', updatedAt: 0, windows: [], permanent: true }
        ]
      } as GroupsState)
    })

    expect(Object.keys(result.current.groups)).toHaveLength(1)
  })
})
