import { describe, it, expect } from 'vitest'
import {
  TOUR_TASKS,
  activeTourTask,
  findNewGroup,
  findPracticeGroup,
  readOnlyTargets,
  savedGroupIds,
  tourGroupRowSelector,
  type TourTaskContext
} from '@/lib/tourTasks'
import { TOUR_STEPS } from '@/lib/tourSteps'
import {
  availableTourSteps,
  backdropPanels,
  computeCardPosition,
  intersectRects,
  nextChapterIndex,
  parseTourRecord,
  pulseScale,
  spotlightRect,
  tourProgress,
  unionRects,
  type TourStep
} from '@/lib/tour'
import type { Group } from '@/lib/types'

const group = (id: string, extra: Partial<Group> = {}): Group => ({ id, name: id, color: 'rgba(1,1,1,1)', updatedAt: 0, windows: [], ...extra })
const NOW_OPEN = group('now', { name: 'Now Open', permanent: true })

const ctx = (over: Partial<TourTaskContext> = {}): TourTaskContext => ({
  groups: [NOW_OPEN],
  practiceGroupId: null,
  previewColor: null,
  maxGroups: 5,
  renamingGroupIndex: null,
  searchFilter: '',
  theme: 'system',
  modalType: null,
  ...over
})
const step = (id: string) => TOUR_STEPS.find((s) => s.id === id) as TourStep

describe('practice group helpers', () => {
  it('finds the practice group only while it is a normal saved group', () => {
    expect(findPracticeGroup(ctx())).toBeNull()
    expect(findPracticeGroup(ctx({ practiceGroupId: 'gone' }))).toBeNull()
    expect(findPracticeGroup(ctx({ groups: [NOW_OPEN, group('p')], practiceGroupId: 'p' }))?.id).toBe('p')
    expect(findPracticeGroup(ctx({ groups: [NOW_OPEN, group('p', { archived: true })], practiceGroupId: 'p' }))).toBeNull()
    // never the permanent group, whatever the stored id says
    expect(findPracticeGroup(ctx({ practiceGroupId: 'now' }))).toBeNull()
  })

  it('spots the group that was not there when the step was entered', () => {
    const before = savedGroupIds([NOW_OPEN, group('a')])
    expect(before).toEqual(['a'])
    expect(findNewGroup([NOW_OPEN, group('a')], before)).toBeNull()
    expect(findNewGroup([NOW_OPEN, group('a'), group('b')], before)?.id).toBe('b')
  })

  it('escapes the id in the row selector', () => {
    expect(tourGroupRowSelector('a"b')).toBe('[data-sidebar-group-index][data-tm-dnd-id="a\\"b"]')
  })
})

describe('make-group', () => {
  const task = TOUR_TASKS['make-group']

  it('is offered below the group limit and not at it', () => {
    expect(task.available(ctx())).toBe(true)
    const full = [NOW_OPEN, ...['a', 'b', 'c', 'd', 'e'].map((id) => group(id))]
    expect(task.available(ctx({ groups: full }))).toBe(false)
    expect(activeTourTask(step('make-group'), ctx({ groups: full }))).toBeNull()
    // archived groups count towards the limit too
    const archived = full.map((g) => (g.permanent ? g : { ...g, archived: true }))
    expect(task.available(ctx({ groups: archived }))).toBe(false)
    // a practice group from an earlier run is reused even at the limit
    expect(task.available(ctx({ groups: full, practiceGroupId: 'c' }))).toBe(true)
    expect(task.available(ctx({ groups: full, maxGroups: Infinity }))).toBe(true)
  })

  it('is done only when the practice group has a name of its own and is not being renamed', () => {
    const base = { groups: [NOW_OPEN, group('p', { name: 'temp group' })], practiceGroupId: 'p' }
    expect(task.isDone(ctx(), [])).toBe(false)
    expect(task.isDone(ctx(base), [])).toBe(false)
    const named = { ...base, groups: [NOW_OPEN, group('p', { name: 'Practice' })] }
    expect(task.isDone(ctx({ ...named, renamingGroupIndex: 1 }), [])).toBe(false)
    expect(task.isDone(ctx(named), [])).toBe(true)
    expect(task.remember).toBe(false)
  })

  it('unlocks "Add Group" first, then only the new group name', () => {
    expect(task.targets(ctx()).allow).toEqual(['[data-tour="add-group"]'])
    const made = task.targets(ctx({ groups: [NOW_OPEN, group('p')], practiceGroupId: 'p' }))
    expect(made.allow).toEqual(['[data-sidebar-group-index][data-tm-dnd-id="p"] [data-tour="group-name"]'])
    expect(made.highlight).toEqual([['[data-sidebar-group-index][data-tm-dnd-id="p"]']])
  })
})

describe('group-colour and group-pin', () => {
  const withPractice = (extra: Partial<Group> = {}) => ctx({ groups: [NOW_OPEN, group('other'), group('p', extra)], practiceGroupId: 'p' })

  it('are not offered without a practice group, so the tour never asks for a change to an existing group', () => {
    const existing = ctx({ groups: [NOW_OPEN, group('other')] })
    expect(TOUR_TASKS['group-colour'].available(existing)).toBe(false)
    expect(TOUR_TASKS['group-pin'].available(existing)).toBe(false)
    expect(step('group-colour').fallbackBody).toBeTruthy()
    expect(step('group-pin').fallbackBody).toBeTruthy()
  })

  it('colour is done when the stored colour differs from the one the step started with', () => {
    const task = TOUR_TASKS['group-colour']
    const baseline = task.baseline(withPractice())
    expect(task.isDone(withPractice(), baseline)).toBe(false)
    expect(task.isDone(withPractice({ color: 'rgba(2,2,2,1)' }), baseline)).toBe(true)
    // another group changing does not count
    expect(task.isDone(ctx({ groups: [NOW_OPEN, group('other', { color: 'rgba(2,2,2,1)' }), group('p')], practiceGroupId: 'p' }), baseline)).toBe(false)
  })

  it('colour unlocks the dot and its picker, nothing else in the row', () => {
    const { allow, lockRoots } = TOUR_TASKS['group-colour'].targets(withPractice())
    expect(allow).toEqual(['[data-sidebar-group-index][data-tm-dnd-id="p"] [data-tour="group-color"]', '[data-tour="color-picker"]'])
    expect(lockRoots).toEqual([])
  })

  it('pin is done when the pinned state flips, either way', () => {
    const task = TOUR_TASKS['group-pin']
    expect(task.isDone(withPractice({ starred: true }), task.baseline(withPractice()))).toBe(true)
    expect(task.isDone(withPractice(), task.baseline(withPractice({ starred: true })))).toBe(true)
    expect(task.isDone(withPractice(), task.baseline(withPractice()))).toBe(false)
  })
})

describe('search and theme', () => {
  it('search is done once there is a query', () => {
    expect(TOUR_TASKS.search.isDone(ctx(), true)).toBe(false)
    expect(TOUR_TASKS.search.isDone(ctx({ searchFilter: '   ' }), true)).toBe(false)
    expect(TOUR_TASKS.search.isDone(ctx({ searchFilter: 'work' }), true)).toBe(true)
  })

  it('theme waits for settings to load, then is done when the SAVED theme differs', () => {
    const task = TOUR_TASKS.theme
    expect(task.baseline(ctx({ theme: null }))).toBeNull()
    expect(task.isDone(ctx({ theme: 'dark' }), null)).toBe(false)
    expect(task.isDone(ctx({ theme: 'system' }), 'system')).toBe(false)
    expect(task.isDone(ctx({ theme: 'dark' }), 'system')).toBe(true)
    expect(task.modal).toBe('settings')
  })

  it('theme locks the menu and Settings down to the path it asks for', () => {
    const closed = TOUR_TASKS.theme.targets(ctx())
    expect(closed.allow).toContain('[data-tour="account-menu"]')
    expect(closed.allow).toContain('[data-tour="menu-settings"]')
    expect(closed.lockRoots).toEqual(['[data-tour="account-menu-content"]', '[role="dialog"]:not([data-tour-card])'])
    const open = TOUR_TASKS.theme.targets(ctx({ modalType: 'settings' }))
    expect(open.allow).not.toContain('[data-tour="account-menu"]')
    expect(open.allow).toEqual(expect.arrayContaining(['[data-tour="settings-theme"]', '[data-tour="settings-save-button"]']))
    // the footer (Restore defaults and its neighbours) is not unlocked, only the Save button
    expect(open.allow).not.toContain('[data-tour="settings-save"]')
    expect(open.allow.some((s) => s.includes('settings-save"'))).toBe(false)
    expect(open.allow.some((s) => /restore|footer/i.test(s))).toBe(false)
  })
})

describe('action ring lists, furthest point first', () => {
  const ROW = '[data-sidebar-group-index][data-tm-dnd-id="p"]'
  const PICKER = '[data-tour="color-picker"]'
  const withPractice = (over: Partial<TourTaskContext> = {}) => ctx({ groups: [NOW_OPEN, group('p', { color: 'rgba(1,1,1,1)' })], practiceGroupId: 'p', ...over })

  it('make-group without a practice group points at Add Group only', () => {
    const t = TOUR_TASKS['make-group'].targets(ctx())
    expect(t.action).toEqual([['[data-tour="add-group"]']])
    expect(t.highlight).toEqual([['[data-tour="add-group"]']])
  })

  it('make-group with a practice group lists Save (only once marked ready) before the name field', () => {
    const t = TOUR_TASKS['make-group'].targets(withPractice())
    expect(t.action).toEqual([
      [`${ROW} [data-tour="group-name-save"][data-tour-ready]`],
      [`${ROW} [data-tour="group-name-input"]`]
    ])
  })

  it('group-colour lists only the dot and the swatches until a different colour is being tried', () => {
    const dot = `${ROW} [data-tour="group-color"]`
    const swatches = `${PICKER} [data-tour="color-swatches"]`
    const apply = `${PICKER} [data-tour="color-apply"]`
    const t = TOUR_TASKS['group-colour']
    expect(t.targets(withPractice({ previewColor: null })).action).toEqual([[swatches], [dot]])
    // the preview equals the stored colour: nothing to apply yet
    expect(t.targets(withPractice({ previewColor: 'rgba(1,1,1,1)' })).action).toEqual([[swatches], [dot]])
    expect(t.targets(withPractice({ previewColor: 'rgba(9,9,9,1)' })).action).toEqual([[apply], [swatches], [dot]])
    // no practice group: a preview cannot make Apply the target
    expect(t.targets(ctx({ previewColor: 'rgba(9,9,9,1)' })).action).toEqual([[swatches], ['[data-tour="groups"] [data-tour="group-color"]']])
  })

  it('group-pin points at the practice group star', () => {
    expect(TOUR_TASKS['group-pin'].targets(withPractice()).action).toEqual([[`${ROW} [data-tour="group-pin"]`]])
  })

  it('search points at the field inside the open box, else at the Open search box', () => {
    const t = TOUR_TASKS.search.targets(ctx())
    expect(t.action).toHaveLength(2)
    expect(t.action[0][0]).toMatch(/search-overlay.*input|input/)
    expect(t.action[1]).toEqual(t.highlight[1])
  })

  it('theme: menu path while Settings is closed, list box > Save changes > Theme control once it is open', () => {
    const closed = TOUR_TASKS.theme.targets(ctx({ modalType: null }))
    expect(closed.action).toEqual([['[data-tour="menu-settings"]'], ['[data-tour="account-menu"]']])
    const open = TOUR_TASKS.theme.targets(ctx({ modalType: 'settings' }))
    expect(open.action).toEqual([
      ['[role="listbox"]'],
      ['[data-tour="settings-save-button"]:not([disabled])'],
      ['[data-tour="settings-theme-trigger"]']
    ])
  })

  it('every task gives a non-empty action list in every state', () => {
    for (const id of Object.keys(TOUR_TASKS) as Array<keyof typeof TOUR_TASKS>) {
      for (const c of [ctx(), withPractice(), withPractice({ modalType: 'settings', previewColor: 'rgba(9,9,9,1)' })]) {
        const t = TOUR_TASKS[id].targets(c)
        expect(t.action.length, id).toBeGreaterThan(0)
        for (const list of t.action) expect(list.length, id).toBeGreaterThan(0)
      }
    }
  })
})

describe('availability at the Free group limit', () => {
  const full = [NOW_OPEN, ...['a', 'b', 'c', 'd', 'e'].map((id) => group(id))]

  it('make-group, colour and pin all fall back to read-only text', () => {
    const c = ctx({ groups: full })
    expect(activeTourTask(step('make-group'), c)).toBeNull()
    expect(activeTourTask(step('group-colour'), c)).toBeNull()
    expect(activeTourTask(step('group-pin'), c)).toBeNull()
    // search and theme do not depend on the group count
    expect(activeTourTask(step('search'), c)).not.toBeNull()
    expect(activeTourTask(step('theme'), c)).not.toBeNull()
  })

  it('a stale practice group id (group deleted) also falls back', () => {
    expect(activeTourTask(step('group-pin'), ctx({ practiceGroupId: 'deleted' }))).toBeNull()
  })
})

describe('read-only steps', () => {
  it('highlight their anchor and extras as one ring, and unlock nothing', () => {
    expect(readOnlyTargets(step('undo'))).toEqual({ highlight: [['[data-tour="undo"]', '[data-tour="redo"]']], action: [], allow: [], lockRoots: [] })
    expect(readOnlyTargets(step('welcome')).highlight).toEqual([])
  })

  it('a step without a task has no active task', () => {
    expect(activeTourTask(step('welcome'), ctx())).toBeNull()
    expect(activeTourTask(null, ctx())).toBeNull()
  })
})

describe('chapters and progress', () => {
  const steps: TourStep[] = [
    { id: 'a', chapter: 'one', anchor: null, title: 'A', body: 'a', placement: 'center' },
    { id: 'b', chapter: 'one', anchor: null, title: 'B', body: 'b', placement: 'center' },
    { id: 'c', chapter: 'three', anchor: null, title: 'C', body: 'c', placement: 'center' }
  ]
  const chapters = [
    { id: 'one', title: 'One', description: 'About one' },
    { id: 'two', title: 'Two', description: 'About two' },
    { id: 'three', title: 'Three', description: 'About three' }
  ]

  it('counts only chapters that still have steps', () => {
    expect(tourProgress(steps, 1, chapters)).toEqual({ step: 2, total: 3, chapter: 1, chapters: 2, chapterTitle: 'One', chapterDescription: 'About one', stepInChapter: 2, stepsInChapter: 2 })
    expect(tourProgress(steps, 2, chapters)).toMatchObject({ chapter: 2, chapters: 2, chapterTitle: 'Three', chapterDescription: 'About three', stepInChapter: 1, stepsInChapter: 1 })
  })

  it('gives empty chapter text for a chapter id that is not in the list', () => {
    expect(tourProgress(steps, 0, [])).toMatchObject({ chapterTitle: '', chapterDescription: '' })
  })

  it('finds the first step of the next chapter, or -1 in the last one', () => {
    expect(nextChapterIndex(steps, 0)).toBe(2)
    expect(nextChapterIndex(steps, 1)).toBe(2)
    expect(nextChapterIndex(steps, 2)).toBe(-1)
  })

  it('drops flagged steps unless the feature is on, and keeps interactive steps whose anchor is missing', () => {
    const root = document.createElement('div')
    const list: TourStep[] = [
      { id: 'ai', chapter: 'one', anchor: null, title: 'AI', body: 'x', placement: 'center', when: 'ai' },
      { id: 'task', chapter: 'one', anchor: 'missing', title: 'T', body: 'x', placement: 'right', task: 'search' },
      { id: 'gone', chapter: 'one', anchor: 'missing', title: 'G', body: 'x', placement: 'right' }
    ]
    expect(availableTourSteps(list, root).map((s) => s.id)).toEqual(['task'])
    expect(availableTourSteps(list, root, { aiEnabled: true }).map((s) => s.id)).toEqual(['ai', 'task'])
  })
})

describe('stored record', () => {
  it('keeps a valid practice group id on pending and done records, and drops a bad one', () => {
    expect(parseTourRecord({ status: 'done', practiceGroupId: 'g1' })).toEqual({ status: 'done', practiceGroupId: 'g1' })
    expect(parseTourRecord({ status: 'pending', stepId: 's', practiceGroupId: 'g1' })).toEqual({ status: 'pending', stepId: 's', practiceGroupId: 'g1' })
    expect(parseTourRecord({ status: 'done', practiceGroupId: 7 })).toEqual({ status: 'done' })
    expect(parseTourRecord({ status: 'done', practiceGroupId: 'a'.repeat(65) })).toEqual({ status: 'done' })
  })
})

describe('highlight geometry', () => {
  const frame = { width: 800, height: 600 }

  it('keeps the cut-out away from the frame edge so the ring and pulse fit inside', () => {
    // a sidebar row touching x = 0
    expect(spotlightRect({ left: 0, top: 46, width: 240, height: 36 }, 4, frame, 10)).toEqual({ left: 10, top: 42, width: 234, height: 44 })
    // a bottom-right corner anchor
    const r = spotlightRect({ left: 760, top: 570, width: 40, height: 30 }, 4, frame, 10)
    expect(r.left + r.width).toBe(790)
    expect(r.top + r.height).toBe(590)
  })

  it('intersects and unions rectangles', () => {
    expect(intersectRects({ left: 0, top: 0, width: 10, height: 10 }, { left: 5, top: 5, width: 10, height: 10 })).toEqual({ left: 5, top: 5, width: 5, height: 5 })
    expect(intersectRects({ left: 0, top: 0, width: 10, height: 10 }, { left: 20, top: 0, width: 5, height: 5 })).toBeNull()
    expect(unionRects([])).toBeNull()
    expect(unionRects([{ left: 0, top: 0, width: 10, height: 10 }, { left: 20, top: 5, width: 5, height: 20 }])).toEqual({ left: 0, top: 0, width: 25, height: 25 })
  })

  it('covers everything around the hole with four panels that do not overlap it', () => {
    const hole = { left: 100, top: 50, width: 200, height: 100 }
    const panels = backdropPanels(hole, frame)
    const area = panels.reduce((sum, p) => sum + p.width * p.height, 0)
    expect(area).toBe(frame.width * frame.height - hole.width * hole.height)
    for (const p of panels) expect(intersectRects(p, hole)).toBeNull()
  })

  it('scales the pulse by the same distance on every side', () => {
    const s = pulseScale({ width: 200, height: 40 }, 4)
    expect(s.x * 200 - 200).toBeCloseTo(8)
    expect(s.y * 40 - 40).toBeCloseTo(8)
    expect(pulseScale({ width: 0, height: 0 }, 4)).toEqual({ x: 1, y: 1 })
  })

  it('puts the card in the asked-for corner of the frame when no side of the anchor has room', () => {
    const anchor = { left: 172, top: 22, width: 456, height: 557 }
    const pos = computeCardPosition({ anchor, card: { width: 320, height: 300 }, frame, placement: 'bottom', gap: 16, margin: 8, fallbackCorner: 'bottom-left' })
    expect(pos).toEqual({ left: 8, top: 292, placement: 'inside' })
  })
})
