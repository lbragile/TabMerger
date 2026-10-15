import { describe, it, expect } from 'vitest'
import {
  TOUR_DRAG_TASKS,
  TOUR_TASKS,
  tourDemoTabRowSelector,
  tourDemoWindowSelector,
  tourMenuItemSelector,
  tourTask,
  type TourTaskContext,
} from '@/lib/tourTasks'
import { TOUR_SIGNALS } from '@/lib/tourSandbox'
import { buildTourDemoGroups, TOUR_DEMO_MAIN_ID, TOUR_DEMO_TARGET_ID } from '@/lib/tourDemo'
import type { Group, Tab } from '@/lib/types'

const NOW_OPEN: Group = { id: 'now', name: 'Now Open', color: 'rgba(1,1,1,1)', updatedAt: 0, windows: [], permanent: true }
const tab = (url: string, id = 0, title = url): Tab => ({ id, title, url, savedAt: 0 })
const win = (tabs: Tab[], extra = {}) => ({ id: 0, name: 'w', tabs, incognito: false, focused: false, ...extra })

const ctx = (over: Partial<TourTaskContext> = {}): TourTaskContext => ({
  groups: [NOW_OPEN, ...buildTourDemoGroups(1)],
  practiceGroupId: null,
  previewColor: null,
  maxGroups: 5,
  renamingGroupIndex: null,
  searchFilter: '',
  theme: 'system',
  modalType: null,
  practiceTab: { id: null, url: '', state: 'off' },
  signals: {},
  selectionMode: false,
  selectedIds: [],
  ...over,
})
const noDemo = () => ctx({ groups: [NOW_OPEN] })
const withMain = (patch: (g: Group) => Group) => ctx({ groups: [NOW_OPEN, ...buildTourDemoGroups(1).map((g) => (g.id === TOUR_DEMO_MAIN_ID ? patch(g) : g))] })

describe('tourTask lookup', () => {
  it('finds drag and plain tasks, and undefined for an unknown id', () => {
    expect(tourTask('save-tabs')).toBe(TOUR_DRAG_TASKS['save-tabs'])
    expect(tourTask('search')).toBe(TOUR_TASKS.search)
    expect(tourTask('nope' as never)).toBeUndefined()
  })
})

describe('open-tabs', () => {
  const t = TOUR_TASKS['open-tabs']
  it('is offered only while the first window of Tour demo has tabs', () => {
    expect(t.available(ctx())).toBe(true)
    expect(t.available(noDemo())).toBe(false)
    expect(t.available(withMain((g) => ({ ...g, windows: [] })))).toBe(false)
    expect(t.available(withMain((g) => ({ ...g, windows: [{ ...g.windows[0], tabs: [] }] })))).toBe(false)
  })
  it('needs fresh data when the first window is not the Reading one (or the group is gone)', () => {
    expect(t.needsFresh!(ctx())).toBe(false)
    expect(t.needsFresh!(withMain((g) => ({ ...g, windows: [{ ...g.windows[0], name: 'Other' }] })))).toBe(true)
    expect(t.needsFresh!(noDemo())).toBe(true)
  })
  it('is done once the open-window signal count rises above the baseline', () => {
    const base = t.baseline(ctx())
    expect(base).toBe(0)
    expect(t.isDone(ctx(), base)).toBe(false)
    expect(t.isDone(ctx({ signals: { [TOUR_SIGNALS.openWindow]: 1 } }), base)).toBe(true)
    expect(t.isDone(ctx({ signals: { [TOUR_SIGNALS.openWindow]: 3 } }), 3)).toBe(false)
    expect(t.isDone(ctx({ signals: { [TOUR_SIGNALS.openWindow]: 3 } }), null)).toBe(false)
    expect(t.baseline(ctx({ signals: { [TOUR_SIGNALS.openWindow]: 2 } }))).toBe(2)
  })
  it('unlocks the window menu button and the one item', () => {
    const { allow, action, lockRoots } = t.targets(ctx())
    expect(allow).toHaveLength(2)
    expect(allow[1]).toBe(tourMenuItemSelector('Open in browser'))
    expect(action).toHaveLength(2)
    expect(lockRoots).toEqual(['[role="menu"]'])
  })
})

describe('tidy-up', () => {
  const t = TOUR_TASKS['tidy-up']
  const noDupes = () => withMain((g) => ({ ...g, windows: [win([tab('https://a.test'), tab('https://b.test')])] }))
  it('is offered with Tour demo present', () => {
    expect(t.available(ctx())).toBe(true)
    expect(t.available(noDemo())).toBe(false)
  })
  it('needs fresh data only when a group exists with no duplicates left', () => {
    expect(t.needsFresh!(ctx())).toBe(false)
    expect(t.needsFresh!(noDupes())).toBe(true)
    expect(t.needsFresh!(noDemo())).toBe(false)
  })
  it('baseline is the duplicate count, null without the group', () => {
    expect(t.baseline(ctx())).toBeGreaterThan(0)
    expect(t.baseline(noDemo())).toBeNull()
  })
  it('is done when it started with duplicates and none remain', () => {
    const base = t.baseline(ctx())
    expect(t.isDone(ctx(), base)).toBe(false)
    expect(t.isDone(noDupes(), base)).toBe(true)
    expect(t.isDone(noDupes(), 0)).toBe(false)
    expect(t.isDone(noDupes(), null)).toBe(false)
    expect(t.isDone(noDemo(), base)).toBe(false)
  })
  it('points at the confirm button once the dialog is open, else at the menu path', () => {
    const closed = t.targets(ctx())
    expect(closed.action).toHaveLength(2)
    expect(closed.actionSteps).toEqual([2, 1])
    expect(closed.allow.length).toBe(4)
    const open = t.targets(ctx({ modalType: 'deduplicateGroup' }))
    expect(open.action).toHaveLength(1)
    expect(open.actionSteps).toEqual([3])
    expect(open.allow.length).toBe(3)
    expect(t.modal).toBe('deduplicateGroup')
  })
})

describe('select-items', () => {
  const t = TOUR_TASKS['select-items']
  it('is offered with sample tabs present', () => {
    expect(t.available(ctx())).toBe(true)
    expect(t.available(noDemo())).toBe(false)
  })
  it('is done only while selecting with a tab of Tour demo selected', () => {
    // groups: now(0) demo1(1) demo2(2)
    expect(t.baseline(ctx())).toBe(true)
    expect(t.isDone(ctx({ selectionMode: true, selectedIds: ['tab-1-0-0'] }), true)).toBe(true)
    expect(t.isDone(ctx({ selectionMode: false, selectedIds: ['tab-1-0-0'] }), true)).toBe(false)
    expect(t.isDone(ctx({ selectionMode: true, selectedIds: ['tab-2-0-0'] }), true)).toBe(false)
    expect(t.isDone(ctx({ selectionMode: true, selectedIds: [] }), true)).toBe(false)
    expect(t.isDone({ ...noDemo(), selectionMode: true, selectedIds: ['tab-1-0-0'] }, true)).toBe(false)
  })
  it('asks for the checkbox once selecting is on, the toggle until then', () => {
    expect(t.targets(ctx()).action).toHaveLength(1)
    expect(t.targets(ctx()).actionSteps).toEqual([1])
    const on = t.targets(ctx({ selectionMode: true }))
    expect(on.action).toHaveLength(2)
    expect(on.actionSteps).toEqual([2, 1])
  })
})

describe('search', () => {
  const t = TOUR_TASKS.search
  it('is offered with Tour demo present', () => {
    expect(t.available(ctx())).toBe(true)
    expect(t.available(noDemo())).toBe(false)
    expect(t.baseline(ctx())).toBe(true)
  })
  it('is done when the plain words are in a sample tab title', () => {
    expect(t.isDone(ctx({ searchFilter: 'recipe' }), true)).toBe(true)
    expect(t.isDone(ctx({ searchFilter: 'RECIPE' }), true)).toBe(true)
    expect(t.isDone(ctx({ searchFilter: 'zzzz' }), true)).toBe(false)
    // under three letters
    expect(t.isDone(ctx({ searchFilter: 're' }), true)).toBe(false)
    // a sparse (missing) tab is skipped without throwing
    const sparse = withMain((g) => ({ ...g, windows: [win([undefined as never, tab('https://x.test', 0, 'Sample: recipe')])] }))
    expect(t.isDone({ ...sparse, searchFilter: 'recipe' }, true)).toBe(true)
    expect(t.isDone({ ...withMain((g) => ({ ...g, windows: [win([undefined as never])] })), searchFilter: 'recipe' }, true)).toBe(false)
  })
})

describe('search-filters', () => {
  const t = TOUR_TASKS['search-filters']
  const narrowed = TOUR_SIGNALS.searchNarrowed
  it('is offered with Tour demo present', () => {
    expect(t.available(ctx())).toBe(true)
    expect(t.available(noDemo())).toBe(false)
  })
  it('reports the milestone while the group: filter names a practice group', () => {
    expect(t.milestone!(ctx({ searchFilter: 'group:Tour demo' }))).toBe(narrowed)
    expect(t.milestone!(ctx({ searchFilter: 'group:TOUR DEMO' }))).toBe(narrowed)
    expect(t.milestone!(ctx({ searchFilter: 'group:tour' }))).toBeNull()
    expect(t.milestone!(ctx({ searchFilter: 'recipe' }))).toBeNull()
    expect(t.milestone!(ctx({ searchFilter: '' }))).toBeNull()
  })
  it('is done after the milestone was reached and the box is empty again', () => {
    const base = t.baseline(ctx())
    expect(base).toBe(0)
    expect(t.isDone(ctx({ signals: { [narrowed]: 1 }, searchFilter: '' }), base)).toBe(true)
    expect(t.isDone(ctx({ signals: { [narrowed]: 1 }, searchFilter: '  ' }), base)).toBe(true)
    expect(t.isDone(ctx({ signals: { [narrowed]: 1 }, searchFilter: 'group:Tour demo' }), base)).toBe(false)
    expect(t.isDone(ctx({ signals: {}, searchFilter: '' }), base)).toBe(false)
    expect(t.isDone(ctx({ signals: { [narrowed]: 1 } }), null)).toBe(false)
    expect(t.baseline(ctx({ signals: { [narrowed]: 4 } }))).toBe(4)
  })
  it('targets: typing, picking from the list, then clearing', () => {
    const typing = t.targets(ctx({ searchFilter: '' }))
    expect(typing.actionSteps).toEqual([2, 1])
    expect(typing.action).toHaveLength(2)
    const picking = t.targets(ctx({ searchFilter: 'group:tou' }))
    expect(picking.actionSteps).toEqual([3, 2, 1])
    expect(picking.action[0][0]).toContain('button:not([aria-label])')
    // a quoted (finished) value is not the picking state
    expect(t.targets(ctx({ searchFilter: 'group:"Tour demo"' })).actionSteps).toEqual([4, 4])
    const done = t.targets(ctx({ searchFilter: 'group:Tour demo' }))
    expect(done.actionSteps).toEqual([4, 4])
    expect(done.action).toHaveLength(2)
    expect(done.lowCard).toBe(true)
  })
})

describe('undo', () => {
  const t = TOUR_TASKS.undo
  it('is offered while Tour demo has a window', () => {
    expect(t.available(ctx())).toBe(true)
    expect(t.available(noDemo())).toBe(false)
    expect(t.available(withMain((g) => ({ ...g, windows: [] })))).toBe(false)
  })
  it('needs fresh data when the first window is missing, starred, or not the Reading one', () => {
    expect(t.needsFresh!(ctx())).toBe(false)
    expect(t.needsFresh!(noDemo())).toBe(true)
    expect(t.needsFresh!(withMain((g) => ({ ...g, windows: [] })))).toBe(true)
    expect(t.needsFresh!(withMain((g) => ({ ...g, windows: [{ ...g.windows[0], starred: true }] })))).toBe(true)
    expect(t.needsFresh!(withMain((g) => ({ ...g, windows: [{ ...g.windows[0], name: 'X' }] })))).toBe(true)
  })
  it('is done only when BOTH undo and redo were used since the baseline', () => {
    const base = t.baseline(ctx({ signals: { [TOUR_SIGNALS.undo]: 2, [TOUR_SIGNALS.redo]: 1 } }))
    expect(base).toEqual({ undo: 2, redo: 1 })
    expect(t.baseline(ctx())).toEqual({ undo: 0, redo: 0 })
    const c = (undo: number, redo: number) => ctx({ signals: { [TOUR_SIGNALS.undo]: undo, [TOUR_SIGNALS.redo]: redo } })
    expect(t.isDone(c(3, 2), base)).toBe(true)
    expect(t.isDone(c(3, 1), base)).toBe(false)
    expect(t.isDone(c(2, 2), base)).toBe(false)
    expect(t.isDone(c(3, 2), null)).toBe(false)
    expect(t.isDone(c(3, 2), { undo: 'x' })).toBe(false)
    expect(t.isDone(c(3, 2), {})).toBe(false)
  })
  it('lists Redo, then Undo, then the window star', () => {
    const { action, actionSteps } = t.targets(ctx())
    expect(action).toHaveLength(3)
    expect(action[0][0]).toContain(':not([disabled])')
    expect(actionSteps).toEqual([3, 2, 1])
  })
})

describe('group-color / group-pin / make-group edge branches', () => {
  const practice = (extra: Partial<Group> = {}) => ctx({ groups: [NOW_OPEN, { id: 'p', name: 'P', color: 'rgba(1,1,1,1)', updatedAt: 0, windows: [], ...extra }], practiceGroupId: 'p' })
  it('baseline is null without a practice group, and then nothing is done', () => {
    expect(TOUR_TASKS['group-color'].baseline(noDemo())).toBeNull()
    expect(TOUR_TASKS['group-color'].isDone(practice({ color: 'rgba(9,9,9,1)' }), null)).toBe(false)
    expect(TOUR_TASKS['group-color'].isDone(noDemo(), 'rgba(1,1,1,1)')).toBe(false)
    expect(TOUR_TASKS['group-pin'].baseline(noDemo())).toBeNull()
    expect(TOUR_TASKS['group-pin'].isDone(practice({ starred: true }), null)).toBe(false)
    expect(TOUR_TASKS['group-pin'].isDone(noDemo(), false)).toBe(false)
  })
  it('group-pin falls back to the groups list when the practice group is gone', () => {
    expect(TOUR_TASKS['group-pin'].targets(noDemo()).highlight[0][0]).toContain('groups')
  })
  it('make-group baseline lists the saved group ids', () => {
    expect(TOUR_TASKS['make-group'].baseline(practice())).toEqual(['p'])
  })
  it('theme baseline passes the saved theme through', () => {
    expect(TOUR_TASKS.theme.available(noDemo())).toBe(true)
    expect(TOUR_TASKS.theme.baseline(ctx({ theme: 'dark' }))).toBe('dark')
  })
})

describe('selectors', () => {
  it('escape quotes in the group id', () => {
    expect(tourDemoTabRowSelector('a"b', 1, 2)).toBe('[data-tab-index][data-tm-dnd-id="a\\"b::w1::t2"]')
    expect(tourDemoWindowSelector('a"b', 1)).toBe('[data-tm-dnd-id="a\\"b::w1"]')
    expect(tourMenuItemSelector('He said "hi"')).toContain('He said \\"hi\\"')
  })
})

describe('save-tabs', () => {
  const t = TOUR_DRAG_TASKS['save-tabs']
  const PAGE = 'chrome-extension://abc/tour-practice.html'
  const nowWith = (tabId: number): Group => ({ ...NOW_OPEN, windows: [win([tab(PAGE, tabId), tab('https://other.test', tabId + 1)])] })
  const practiceTab = (id: number | null, state: TourTaskContext['practiceTab']['state'] = 'ready') => ({ id, url: PAGE, state })

  it('is offered with Tour demo present unless the browser refused the tab', () => {
    expect(t.available(ctx())).toBe(true)
    expect(t.available(ctx({ practiceTab: practiceTab(null, 'failed') }))).toBe(false)
    expect(t.available(noDemo())).toBe(false)
    expect(t.baseline(ctx())).toBe(true)
  })

  it('is done when a practice group holds the page and the browser tab left Now Open', () => {
    const saved = withMain((g) => ({ ...g, windows: [...g.windows, win([tab(PAGE)])] }))
    const done = { ...saved, groups: [NOW_OPEN, ...saved.groups.slice(1)], practiceTab: practiceTab(9) }
    expect(t.isDone(done, true)).toBe(true)
    // still open in Now Open
    expect(t.isDone({ ...done, groups: [nowWith(9), ...saved.groups.slice(1)] }, true)).toBe(false)
    // never saved
    expect(t.isDone(ctx({ groups: [nowWith(9), ...ctx().groups.slice(1)], practiceTab: practiceTab(9) }), true)).toBe(false)
    expect(t.isDone(ctx({ practiceTab: practiceTab(9) }), true)).toBe(false)
    // no tab or no address
    expect(t.isDone({ ...done, practiceTab: practiceTab(null) }, true)).toBe(false)
    expect(t.isDone({ ...done, practiceTab: { id: 9, url: '', state: 'ready' } }, true)).toBe(false)
  })

  it('targets the practice tab handle once it is in Now Open, nothing before', () => {
    const before = t.targets(ctx({ practiceTab: practiceTab(null, 'pending') }))
    expect(before.action).toEqual([])
    expect(before.allow).toEqual(['[data-testid="keyboard-move-host"]'])
    expect(before.keepClear).toEqual([])
    const noMain = t.targets(noDemo())
    expect(noMain.drop).toEqual([])
    const ready = t.targets(ctx({ groups: [nowWith(7), ...ctx().groups.slice(1)], practiceTab: practiceTab(7) }))
    expect(ready.action[0][0]).toContain('::w0::t0')
    expect(ready.drop).toHaveLength(1)
    expect(ready.dragOnly).toBe(true)
    // the practice tab absent from Now Open (id not found)
    expect(t.targets(ctx({ groups: [nowWith(7), ...ctx().groups.slice(1)], practiceTab: practiceTab(99) })).action).toEqual([])
    // no Now Open group at all
    expect(t.targets(ctx({ groups: ctx().groups.slice(1), practiceTab: practiceTab(7) })).action).toEqual([])
  })

  it('finds a tab in a later window of Now Open', () => {
    const now2: Group = { ...NOW_OPEN, windows: [win([tab('https://a.test', 1)]), win([undefined as never, tab(PAGE, 5)])] }
    const r = t.targets(ctx({ groups: [now2, ...ctx().groups.slice(1)], practiceTab: practiceTab(5) }))
    expect(r.action[0][0]).toContain('::w1::t0')
  })
})

describe('drag-tab-reorder', () => {
  const t = TOUR_DRAG_TASKS['drag-tab-reorder']
  const urls = (c: TourTaskContext) => t.baseline(c) as string[][]
  const reordered = () => withMain((g) => ({ ...g, windows: g.windows.map((w, i) => (i === 0 ? { ...w, tabs: [...w.tabs].reverse() } : w)) }))
  it('is offered when a window has two or more tabs', () => {
    expect(t.available(ctx())).toBe(true)
    expect(t.available(noDemo())).toBe(false)
    expect(t.available(withMain((g) => ({ ...g, windows: [win([tab('https://a.test')])] })))).toBe(false)
  })
  it('baseline is the addresses per window, null without the group', () => {
    expect(urls(ctx())).toHaveLength(2)
    expect(t.baseline(noDemo())).toBeNull()
  })
  it('is done when the same tabs of a window are in a different order', () => {
    const base = urls(ctx())
    expect(t.isDone(ctx(), base)).toBe(false)
    expect(t.isDone(reordered(), base)).toBe(true)
    expect(t.isDone(noDemo(), base)).toBe(false)
    expect(t.isDone(ctx(), null)).toBe(false)
    // different members (a tab removed) is not a reorder
    expect(t.isDone(withMain((g) => ({ ...g, windows: [{ ...g.windows[0], tabs: g.windows[0].tabs.slice(1) }, g.windows[1]] })), base)).toBe(false)
    // a window that was not in the baseline
    expect(t.isDone(reordered(), [])).toBe(false)
  })
  it('targets the first window with two tabs; locks everything when there is none', () => {
    const r = t.targets(ctx())
    expect(r.action[0][0]).toContain('::w0::t0')
    expect(r.drop![0][0]).toContain('::w0::t2')
    expect(r.keepPanel).toBe(true)
    const empty = t.targets(noDemo())
    expect(empty.action).toEqual([])
    expect(empty.drop).toEqual([])
    expect(empty.allow).toHaveLength(2)
    expect(empty.allow[0]).toContain(TOUR_DEMO_MAIN_ID)
  })
})

describe('drag-tab-window', () => {
  const t = TOUR_DRAG_TASKS['drag-tab-window']
  const moved = () =>
    withMain((g) => ({ ...g, windows: [{ ...g.windows[0], tabs: g.windows[0].tabs.slice(1) }, { ...g.windows[1], tabs: [...g.windows[1].tabs, g.windows[0].tabs[0]] }] }))
  it('is offered with two windows and a tab', () => {
    expect(t.available(ctx())).toBe(true)
    expect(t.available(noDemo())).toBe(false)
    expect(t.available(withMain((g) => ({ ...g, windows: [g.windows[0]] })))).toBe(false)
    expect(t.available(withMain((g) => ({ ...g, windows: g.windows.map((w) => ({ ...w, tabs: [] })) })))).toBe(false)
  })
  it('is done when a tab shows up in a different window than before', () => {
    const base = t.baseline(ctx()) as string[][]
    expect(t.isDone(ctx(), base)).toBe(false)
    expect(t.isDone(moved(), base)).toBe(true)
    expect(t.isDone(noDemo(), base)).toBe(false)
    expect(t.isDone(ctx(), null)).toBe(false)
    expect(t.baseline(noDemo())).toBeNull()
  })
  it('targets the other window, and goes back to window 0 when the tab is in the last one', () => {
    expect(t.targets(ctx()).drop![0][0]).toContain('::w1')
    const second = withMain((g) => ({ ...g, windows: [{ ...g.windows[0], tabs: [] }, g.windows[1]] }))
    const r = t.targets(second)
    expect(r.action[0][0]).toContain('::w1::t0')
    expect(r.drop![0][0]).toContain('::w0')
    const locked = t.targets(withMain((g) => ({ ...g, windows: [g.windows[0]] })))
    expect(locked.action).toEqual([])
    expect(t.targets(noDemo()).drop).toEqual([])
  })
})

describe('drag-tab-group', () => {
  const t = TOUR_DRAG_TASKS['drag-tab-group']
  const dropped = () =>
    ctx({ groups: [NOW_OPEN, ...buildTourDemoGroups(1).map((g) => (g.id === TOUR_DEMO_TARGET_ID ? { ...g, windows: [win([...g.windows[0].tabs, tab('https://new.test')])] } : g))] })
  const targetGone = () => ctx({ groups: [NOW_OPEN, buildTourDemoGroups(1)[0]] })
  it('is offered with both practice groups and a tab to move', () => {
    expect(t.available(ctx())).toBe(true)
    expect(t.available(targetGone())).toBe(false)
    expect(t.available(withMain((g) => ({ ...g, windows: [] })))).toBe(false)
    expect(t.available(noDemo())).toBe(false)
  })
  it('is done when the target holds an address it did not have', () => {
    const base = t.baseline(ctx())
    expect(t.isDone(ctx(), base)).toBe(false)
    expect(t.isDone(dropped(), base)).toBe(true)
    expect(t.isDone(targetGone(), base)).toBe(false)
    expect(t.isDone(ctx(), null)).toBe(false)
    expect(t.baseline(targetGone())).toBeNull()
  })
  it('targets the group row; locks everything when something is missing', () => {
    const r = t.targets(ctx())
    expect(r.drop![0][0]).toContain(TOUR_DEMO_TARGET_ID)
    expect(r.keepPanel).toBeUndefined()
    expect(t.targets(targetGone()).drop).toEqual([])
    expect(t.targets(withMain((g) => ({ ...g, windows: [] }))).action).toEqual([])
  })
})

describe('drag-group-order', () => {
  const t = TOUR_DRAG_TASKS['drag-group-order']
  const swapped = () => ctx({ groups: [NOW_OPEN, ...buildTourDemoGroups(1).reverse()] })
  it('is offered with both groups at the same pin state', () => {
    expect(t.available(ctx())).toBe(true)
    expect(t.available(withMain((g) => ({ ...g, starred: true })))).toBe(false)
    expect(t.available(noDemo())).toBe(false)
    expect(t.available(ctx({ groups: [NOW_OPEN, buildTourDemoGroups(1)[0]] }))).toBe(false)
  })
  it('is done when the order is the other way round', () => {
    const base = t.baseline(ctx())
    expect(base).toEqual([TOUR_DEMO_MAIN_ID, TOUR_DEMO_TARGET_ID])
    expect(t.isDone(ctx(), base)).toBe(false)
    expect(t.isDone(swapped(), base)).toBe(true)
    expect(t.isDone(ctx(), null)).toBe(false)
    expect(t.isDone(ctx({ groups: [NOW_OPEN, buildTourDemoGroups(1)[0]] }), base)).toBe(false)
    expect(t.baseline(noDemo())).toBeNull()
  })
  it('targets the upper group handle and the gap under the lower one', () => {
    const r = t.targets(ctx())
    expect(r.action[0][0]).toContain(TOUR_DEMO_MAIN_ID)
    expect(r.drop![0][0]).toContain(TOUR_DEMO_TARGET_ID)
    expect(r.dropKind).toBe('below')
    const none = t.targets(noDemo())
    expect(none.action).toEqual([])
    expect(none.drop).toEqual([])
    expect(none.keepClear).toEqual([])
    const one = t.targets(ctx({ groups: [NOW_OPEN, buildTourDemoGroups(1)[0]] }))
    expect(one.action).toHaveLength(1)
    expect(one.drop).toEqual([])
  })
})
