/**
 * groupDnd.test.ts  — REWRITTEN for the DnD rework (RED PHASE)
 *
 * WHAT CHANGED & WHY:
 *   The old file tested `useGroupDndHandlers` from `@/hooks/useDnd`, driving it with
 *   string ids ("group-1", "group-2", "tab-5-0-0") parsed by `parseDndId`. Both the
 *   hook and `parseDndId` are being removed: sidebar group reordering now goes
 *   through the pure `applyMove(model, state, active, over)` in `@/lib/dndMove`, with
 *   refs shaped `{ type:'group', id, index? }` where `id` is a synthesized model id
 *   from `buildDndModel`. The guard cases (no permanent-group drag, no drop before
 *   index 0, zone enforcement, no-op on non-group over) are re-expressed against that
 *   pure API. Analytics assertions were dropped from this layer — `applyMove` is pure
 *   and does not emit `trackEvent` (that moves to the handler hook).
 *
 * These MUST fail now with "Cannot find module '@/lib/dndMove'". Green once reworked.
 */
import { describe, it, expect } from 'vitest'
import { canDrop, applyMove } from '@/lib/dndMove'
import { buildDndModel } from '@/hooks/useDndModel'
import type { Group, GroupsState } from '@/lib/types'

function makeGroup(id: string, overrides: Partial<Group> = {}): Group {
  return { id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 0, windows: [], permanent: false, ...overrides }
}
function makeState(groups: Group[]): GroupsState {
  return { active: { id: groups[0].id, index: 0 }, available: groups }
}
function m(s: GroupsState) {
  const model = buildDndModel(s)
  return { model, gid: (i: number) => model.groupIds[i] }
}
const gref = (id: string, index?: number) => ({ type: 'group' as const, id, index })

describe('group reorder via applyMove', () => {
  it('moves group from render index 1 to index 2 and returns a new persisted state', () => {
    const s = makeState([makeGroup('now-open', { permanent: true }), makeGroup('g1'), makeGroup('g2')])
    const { model, gid } = m(s)

    const res = applyMove(model, s, gref(gid(1)), gref(gid(2), 2))

    expect(res.next.available[1].id).toBe('g2')
    expect(res.next.available[2].id).toBe('g1')
    expect(res.undoable).toBe(true)
  })

  it('rejects dragging the permanent (Now Open) group', () => {
    const s = makeState([makeGroup('now-open', { permanent: true }), makeGroup('g1')])
    const { model, gid } = m(s)
    expect(canDrop(model, gref(gid(0)), gref(gid(1)))).toBe(false)
  })

  it('rejects a drop at index 0 (before the permanent group)', () => {
    const s = makeState([makeGroup('now-open', { permanent: true }), makeGroup('g1'), makeGroup('g2')])
    const { model, gid } = m(s)
    expect(canDrop(model, gref(gid(2)), gref(gid(0), 0))).toBe(false)
  })

  it('enforces zone order: an unstarred group dropped into the starred zone is clamped below the starred groups', () => {
    const s = makeState([
      makeGroup('now-open', { permanent: true }),
      makeGroup('starred', { starred: true }),
      makeGroup('g1'),
      makeGroup('g2'),
    ])
    const { model, gid } = m(s)
    const res = applyMove(model, s, gref(gid(2)), gref(gid(1), 1))

    expect(res.next.available[0].permanent).toBe(true)
    const firstUnstarredIdx = res.next.available.findIndex((g, i) => i > 0 && !g.starred)
    const lastStarredIdx = res.next.available.reduce((acc, g, i) => (g.starred ? i : acc), -1)
    expect(lastStarredIdx).toBeLessThan(firstUnstarredIdx)
    // moved group did not silently acquire starred
    expect(res.next.available.find((g) => g.id === 'g1')!.starred).toBeFalsy()
  })

  it('is not a legal drop when the "over" target is a window rather than a group row', () => {
    const s = makeState([
      makeGroup('now-open', { permanent: true }),
      { ...makeGroup('g1'), windows: [{ id: 0, tabs: [], incognito: false, focused: false }] },
    ])
    const { model, gid } = m(s)
    const windowId = model.groups[gid(1)].windowIds[0]
    expect(canDrop(model, gref(gid(1)), { type: 'window', id: windowId } as never)).toBe(false)
  })
})

describe('sequential group drags stay consistent (ported from the removed useGroupDndHandlers block)', () => {
  it('two back-to-back drags each operate on the prior result, not stale state', () => {
    // [NowOpen, GroupA*, GroupB*, GroupC, GroupD]
    const s0 = makeState([
      makeGroup('now-open', { permanent: true }),
      makeGroup('a', { starred: true }),
      makeGroup('b', { starred: true }),
      makeGroup('c'),
      makeGroup('d'),
    ])

    // Drag 1: GroupD (render idx 4) → onto GroupB (render idx 2)
    const m0 = buildDndModel(s0)
    const r1 = applyMove(m0, s0, gref(m0.groupIds[4]), gref(m0.groupIds[2], 2))
    const s1 = r1.next
    // Now Open still first
    expect(s1.available[0].permanent).toBe(true)
    const dIdx1 = s1.available.findIndex((g) => g.id === 'd')
    const cIdx1 = s1.available.findIndex((g) => g.id === 'c')
    // starred groups stay ahead of unstarred; d + c are the unstarred tail in original order
    expect(dIdx1).toBeLessThan(cIdx1)

    // Drag 2: GroupC → onto GroupB, feeding the POST-drag-1 state back in
    const m1 = buildDndModel(s1)
    const cRenderIdx = s1.available.findIndex((g) => g.id === 'c')
    const bRenderIdx = s1.available.findIndex((g) => g.id === 'b')
    const r2 = applyMove(m1, s1, gref(m1.groupIds[cRenderIdx]), gref(m1.groupIds[bRenderIdx], bRenderIdx))
    const s2 = r2.next

    expect(s2.available[0].permanent).toBe(true)
    // C must NOT have jumped to index 1 (the old updatedAt-sort bug)
    const cIdx2 = s2.available.findIndex((g) => g.id === 'c')
    expect(cIdx2).toBeGreaterThan(1)
    // no window/group loss across the two drags
    expect(s2.available.map((g) => g.id).sort()).toEqual(['a', 'b', 'c', 'd', 'now-open'])
  })
})
