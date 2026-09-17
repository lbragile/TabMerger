/**
 * windowDnd.test.ts  — REWRITTEN for the DnD rework (RED PHASE)
 *
 * WHAT CHANGED & WHY:
 *   The old file tested `useWindowDndHandlers(groupIndex)` from `@/hooks/useDnd`,
 *   driven by string ids ("window-0-0", "group-1") + `parseDndId`, asserting the
 *   `dnd_reorder` / `dnd_reorder{kind:window_cross_group}` analytics events. That
 *   hook and `parseDndId` are removed. Window reordering (in-group) and the
 *   cross-group "combine" path now go through the pure `applyMove` in `@/lib/dndMove`
 *   with `{ type:'window', id, groupId }` / `{ type:'group', id }` refs built from
 *   `buildDndModel`. The "cross-group combine" case — previously the only working
 *   cross-group path — is kept and converted; the no-op guard becomes a `canDrop`
 *   assertion. Analytics is no longer this layer's concern (pure fn).
 *
 * MUST fail now with "Cannot find module '@/lib/dndMove'". Green once reworked.
 */
import { describe, it, expect } from 'vitest'
import { canDrop, applyMove } from '@/lib/dndMove'
import { buildDndModel } from '@/hooks/useDndModel'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

function tab(title: string): Tab {
  return { id: 0, title, url: `https://example.com/${title}` }
}
function makeWin(tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow {
  return { id: 0, tabs, incognito: false, focused: false, ...over }
}
function makeGroup(id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group {
  return { id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 0, windows, permanent: false, ...over }
}
function makeState(groups: Group[]): GroupsState {
  return { active: { id: groups[0].id, index: 0 }, available: groups }
}
function refs(s: GroupsState) {
  const model = buildDndModel(s)
  const gid = (i: number) => model.groupIds[i]
  const wid = (gi: number, wi: number) => model.groups[gid(gi)].windowIds[wi]
  return {
    model,
    winRef: (gi: number, wi: number) => ({ type: 'window' as const, id: wid(gi, wi), groupId: gid(gi) }),
    groupRef: (gi: number) => ({ type: 'group' as const, id: gid(gi) }),
  }
}

describe('window reorder (same group) via applyMove', () => {
  it('reorders two windows within a saved group and bumps updatedAt + pendingSync', () => {
    const s = makeState([makeGroup('g1', [makeWin([tab('a')], { name: 'w0' }), makeWin([tab('b')], { name: 'w1' })])])
    const before = s.available[0].updatedAt
    const { model, winRef } = refs(s)

    const res = applyMove(model, s, winRef(0, 0), { ...winRef(0, 1), index: 1 })

    expect(res.next.available[0].windows.map((w) => w.name)).toEqual(['w1', 'w0'])
    expect(res.next.available[0].updatedAt).toBeGreaterThan(before)
    expect(res.next.available[0].pendingSync).toBe(true)
    expect(res.undoable).toBe(true)
  })
})

describe('window cross-group "combine" via applyMove', () => {
  it('moves a window onto a different group\'s sidebar row: appended to target, removed from source, both bumped', () => {
    const s = makeState([
      makeGroup('g1', [makeWin([tab('a1')], { name: 'w-a' })]),
      makeGroup('g2', [makeWin([tab('b1')], { name: 'w-b' })]),
    ])
    const beforeG1 = s.available[0].updatedAt
    const beforeG2 = s.available[1].updatedAt
    const { model, winRef, groupRef } = refs(s)

    const res = applyMove(model, s, winRef(0, 0), groupRef(1))

    expect(res.next.available[0].windows).toHaveLength(0)
    expect(res.next.available[1].windows.map((w) => w.name)).toContain('w-a')
    expect(res.next.available[0].updatedAt).toBeGreaterThan(beforeG1)
    expect(res.next.available[1].updatedAt).toBeGreaterThan(beforeG2)
    expect(res.next.available[0].pendingSync).toBe(true)
    expect(res.next.available[1].pendingSync).toBe(true)
  })
})

describe('guards (canDrop)', () => {
  it('a window dropped onto itself is not a legal move', () => {
    const s = makeState([makeGroup('g1', [makeWin([tab('a')]), makeWin([tab('b')])])])
    const { model, winRef } = refs(s)
    const same = winRef(0, 0)
    expect(canDrop(model, same, same)).toBe(false)
  })
})

describe('window count invariant (ported from the removed useWindowDndHandlers block)', () => {
  it('reordering an unstarred window into the starred zone does not duplicate or drop windows', () => {
    const s = makeState([
      makeGroup('g1', [
        makeWin([tab('a')], { name: 'starred-a', starred: true }),
        makeWin([tab('b')], { name: 'starred-b', starred: true }),
        makeWin([tab('c')], { name: 'unstarred-c' }),
      ]),
    ])
    const { model, winRef } = refs(s)

    // drag unstarred-c (index 2) to land between the two starred windows (index 1)
    const res = applyMove(model, s, winRef(0, 2), { ...winRef(0, 1), index: 1 })

    const names = res.next.available[0].windows.map((w) => w.name)
    // same total count — no phantom / duplicated windows
    expect(names).toHaveLength(3)
    expect([...names].sort()).toEqual(['starred-a', 'starred-b', 'unstarred-c'])
    expect(new Set(names).size).toBe(names.length)
    // starred zone stays ahead; the moved window is clamped below it and stays unstarred
    expect(res.next.available[0].windows[0].starred).toBe(true)
    expect(res.next.available[0].windows[1].starred).toBe(true)
    expect(res.next.available[0].windows.find((w) => w.name === 'unstarred-c')!.starred).toBeFalsy()
  })
})
