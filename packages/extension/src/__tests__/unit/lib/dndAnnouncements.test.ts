/**
 * dndAnnouncements.test.ts — screen-reader text for popup drags uses real names and
 * positions (never raw positional ids), the drag count, copy semantics, deduped
 * onDragOver, and the outcome `onDragEnd` recorded (committed / rejected / no-op).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  createDndAnnouncements,
  describeDropBail,
  describeDropCommitted,
  describeItem,
  modifierKeyName,
  plural,
  setDndDropOutcome,
  takeDndDropOutcome,
  DND_SCREEN_READER_INSTRUCTIONS
} from '@/lib/dndAnnouncements'
import { clearDndDragSelection, setDndDragSelection } from '@/lib/dndMultiDrag'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

const tab = (title: string, over: Partial<Tab> = {}): Tab => ({ id: 0, title, url: `https://example.com/${title}`, ...over })
const win = (tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false, ...over })
const group = (id: string, name: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({
  id,
  name,
  color: 'rgba(0,0,0,1)',
  updatedAt: 1,
  windows,
  ...over
})

function seed(): GroupsState {
  return {
    active: { id: 'now', index: 0 },
    available: [
      group('now', 'Now Open', [win([tab('Live', { id: 11 })], { id: 700 })], { permanent: true }),
      group('work', 'Work', [win([tab('GitHub'), tab('Docs', { customTitle: 'My docs' }), tab('Mail')]), win([tab('Jira')], { name: 'Tickets' })]),
      group('play', 'Play', [win([tab('Video')])])
    ]
  }
}

const entry = (id: string, type?: string) => ({ id, data: { current: type ? { type } : {} } }) as never

afterEach(() => {
  clearDndDragSelection()
  takeDndDropOutcome()
})

describe('describeItem', () => {
  it('names tabs/windows/groups with 1-based positions and custom titles', () => {
    const s = seed()
    expect(describeItem(s, 'work::w0::t1')).toMatchObject({ type: 'tab', name: 'My docs', position: 'position 2 of 3 in Window 1 of group Work' })
    expect(describeItem(s, 'work::w1')).toMatchObject({ type: 'window', name: 'Tickets', position: 'position 2 of 2 in group Work' })
    // Now Open isn't counted among saved-group positions
    expect(describeItem(s, 'play')).toMatchObject({ type: 'group', name: 'Play', position: 'position 2 of 2' })
    expect(describeItem(s, 'nope')).toBeNull()
    expect(describeItem(null, 'work')).toBeNull()
  })
})

describe('createDndAnnouncements', () => {
  const make = (activeGroupIndex = 1, state: GroupsState | null = seed()) =>
    createDndAnnouncements({ getState: () => state, getActiveGroupIndex: () => activeGroupIndex })

  it('onDragStart: one item → name + position; never the raw positional id', () => {
    const text = make().onDragStart!({ active: entry('work::w0::t0', 'tab') })!
    expect(text).toBe('Picked up tab GitHub, position 1 of 3 in Window 1 of group Work.')
    expect(text).not.toContain('::')
  })

  it('onDragStart: a multi-drag announces the COUNT', () => {
    setDndDragSelection('work::w0::t0', ['work::w0::t0', 'work::w0::t2', 'work::w1::t0'])
    expect(make().onDragStart!({ active: entry('work::w0::t0', 'tab') })).toBe('Picked up 3 tabs, starting with GitHub.')
  })

  it('onDragStart: a picked-up group that will be activated says so; the already-active one does not', () => {
    expect(make(2).onDragStart!({ active: entry('work', 'group') })).toContain('Group Work is now shown.')
    expect(make(1).onDragStart!({ active: entry('work', 'group') })).not.toContain('now shown')
  })

  it('onDragStart: dragging out of Now Open mentions COPY semantics', () => {
    expect(make().onDragStart!({ active: entry('now::w0::t0', 'tab') })).toContain('copies; the open tabs stay open')
  })

  it('onDragStart: falls back to the type when the state is unavailable', () => {
    expect(make(1, null).onDragStart!({ active: entry('x', 'window') })).toBe('Picked up window.')
  })

  it('onDragOver: the immediate over-ITSELF right after pickup is silent (it would overwrite "Picked up …")', () => {
    const a = make()
    a.onDragStart!({ active: entry('work::w0::t0', 'tab') })
    expect(a.onDragOver!({ active: entry('work::w0::t0', 'tab'), over: entry('work::w0::t0', 'tab') })).toBeUndefined()
    // moving away and back later IS announced
    expect(a.onDragOver!({ active: entry('work::w0::t0', 'tab'), over: entry('work::w0::t1', 'tab') })).toMatch(/^Over position 2/)
    expect(a.onDragOver!({ active: entry('work::w0::t0', 'tab'), over: entry('work::w0::t0', 'tab') })).toBe('Over its original position.')
  })

  it('onDragOver: describes the target, and only announces when it CHANGES', () => {
    const a = make()
    a.onDragStart!({ active: entry('work::w0::t0', 'tab') })
    expect(a.onDragOver!({ active: entry('work::w0::t0', 'tab'), over: entry('work::w0::t2', 'tab') })).toBe(
      'Over position 3 of 3 in Window 1 of group Work.'
    )
    expect(a.onDragOver!({ active: entry('work::w0::t0', 'tab'), over: entry('work::w0::t2', 'tab') })).toBeUndefined()
    expect(a.onDragOver!({ active: entry('work::w0::t0', 'tab'), over: entry('play', 'group') })).toBe('Over group Play, as a new window.')
    expect(a.onDragOver!({ active: entry('work::w0::t0', 'tab'), over: entry('play::new-window', 'new-window') })).toBe(
      'Over a new window at the end of group Play.'
    )
    expect(a.onDragOver!({ active: entry('work::w0::t0', 'tab'), over: null })).toBe('Not over a drop target.')
    expect(a.onDragOver!({ active: entry('work::w0::t0', 'tab'), over: null })).toBeUndefined()
    expect(a.onDragOver!({ active: entry('work::w0::t0', 'tab'), over: entry('work::w0::t0', 'tab') })).toBe('Over its original position.')
  })

  it("onDragOver: an invalid target says Can't drop (a live Now Open tab over the Now Open row)", () => {
    const text = make().onDragOver!({ active: entry('now::w0::t0', 'tab'), over: entry('now', 'group') })
    expect(text).toMatch(/^Can't drop on Now Open/)
  })

  it('onDragEnd / onDragCancel read (and consume) the outcome the handler recorded', () => {
    const a = make()
    setDndDropOutcome('Moved tab GitHub to Window 1 of group Play, position 2 of 2.')
    expect(a.onDragEnd!({ active: entry('work::w0::t0', 'tab'), over: null } as never)).toBe(
      'Moved tab GitHub to Window 1 of group Play, position 2 of 2.'
    )
    expect(a.onDragEnd!({ active: entry('work::w0::t0', 'tab'), over: null } as never)).toBe('Tab dropped.')
    setDndDropOutcome('Movement cancelled.')
    expect(a.onDragCancel!({ active: entry('work::w0::t0', 'tab'), over: null } as never)).toBe('Movement cancelled.')
    expect(a.onDragCancel!({ active: entry('work::w0::t0', 'tab'), over: null } as never)).toContain('returned to its position')
  })

  it('custom instructions are SHORT (≤2 sentences: re-read on every grip focus) and cover pickup/drop, arrows, Escape, range + select-all', () => {
    const t = DND_SCREEN_READER_INSTRUCTIONS.draggable
    expect(t.split(/(?<=\.)\s+/).filter(Boolean).length).toBeLessThanOrEqual(2)
    for (const phrase of ['Space to pick up', 'arrow keys', 'Space to drop', 'Escape', 'Shift+Space']) expect(t).toContain(phrase)
    expect(t).toMatch(/(Control|Command)\+A/)
    // copy semantics are announced at pickup from Now Open, not in the shared instructions
  })

  it('modifierKeyName: "Command" on macOS, "Control" elsewhere', () => {
    const spy = vi.spyOn(navigator, 'platform', 'get')
    try {
      spy.mockReturnValue('MacIntel')
      expect(modifierKeyName()).toBe('Command')
      spy.mockReturnValue('Win32')
      expect(modifierKeyName()).toBe('Control')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('describeDropBail', () => {
  it('rejected / no-op / stale / cancelled all name the item and where it returned', () => {
    const s = seed()
    expect(describeDropBail(s, 'work::w0::t1', 'rejected')).toBe(
      "Can't drop there. Tab My docs returned to position 2 of 3 in Window 1 of group Work."
    )
    expect(describeDropBail(s, 'work::w0::t1', 'noop')).toBe('Dropped tab My docs back at position 2 of 3 in Window 1 of group Work; nothing moved.')
    expect(describeDropBail(s, 'work::w0::t1', 'stale')).toContain('The groups changed during the drag')
    expect(describeDropBail(s, 'work::w0::t0', 'cancelled', 3)).toBe('Movement cancelled. The 3 tabs returned to position 1 of 3 in Window 1 of group Work.')
    expect(describeDropBail(null, 'x', 'cancelled')).toBe('Movement cancelled.')
    expect(describeDropBail(null, 'x', 'rejected')).toBe('Dropped; nothing moved.')
  })
})

describe('describeDropCommitted', () => {
  const before = seed()
  it('a saved tab moved into another (hidden) group names destination window + position and says it is not shown', () => {
    const next: GroupsState = {
      ...before,
      available: [before.available[0], group('work', 'Work', [win([tab('Docs'), tab('Mail')]), win([tab('Jira')])]), group('play', 'Play', [win([tab('Video')]), win([tab('GitHub')])])]
    }
    const text = describeDropCommitted({
      before,
      next,
      active: { type: 'tab', id: 'work::w0::t0' },
      count: 1,
      landed: { type: 'tab', positions: [{ groupIndex: 2, windowIndex: 1, tabIndex: 0 }] },
      sideEffects: [],
      activeGroupIndex: 1
    })
    expect(text).toBe('Moved tab GitHub to Window 2 of group Play, position 1 of 1. Group Play is not shown.')
  })

  it('a multi-selection MOVED out of Now Open says Moved + the open tabs are closed', () => {
    const next: GroupsState = { ...before, available: [before.available[0], before.available[1], group('play', 'Play', [win([tab('Video'), tab('Live'), tab('X')])])] }
    const text = describeDropCommitted({
      before,
      next,
      active: { type: 'tab', id: 'now::w0::t0' },
      count: 2,
      landed: { type: 'tab', positions: [{ groupIndex: 2, windowIndex: 0, tabIndex: 1 }, { groupIndex: 2, windowIndex: 0, tabIndex: 2 }] },
      sideEffects: [],
      activeGroupIndex: 2
    })
    expect(text).toBe('Moved 2 tabs to Window 1 of group Play, starting at position 2 of 3. The open tabs are closed.')
  })

  it('windows, group reorders and Now Open destinations', () => {
    expect(
      describeDropCommitted({
        before,
        next: before,
        active: { type: 'window', id: 'work::w1' },
        count: 1,
        landed: { type: 'window', positions: [{ groupIndex: 1, windowIndex: 0 }] },
        sideEffects: [],
        activeGroupIndex: 1
      })
    ).toBe('Moved window Tickets to group Work, position 1 of 2.')
    const reordered: GroupsState = { ...before, available: [before.available[0], before.available[2], before.available[1]] }
    expect(
      describeDropCommitted({ before, next: reordered, active: { type: 'group', id: 'work' }, count: 1, sideEffects: [], activeGroupIndex: 2 })
    ).toBe('Moved group Work to position 2 of 2.')
    const base = { before, next: before, active: { type: 'tab' as const, id: 'work::w0::t0' }, count: 1, activeGroupIndex: 1 }
    expect(describeDropCommitted({ ...base, sideEffects: [{ type: 'windows.create', url: ['u'], focused: false }] })).toBe(
      'Opened tab GitHub in a new browser window.'
    )
    expect(describeDropCommitted({ ...base, sideEffects: [{ type: 'tabs.create', windowId: 1, url: 'u', active: false }] })).toBe(
      'Opened tab GitHub in Now Open.'
    )
    expect(describeDropCommitted({ ...base, sideEffects: [{ type: 'tabs.move', tabId: 11, windowId: 1, index: 0 }] })).toBe(
      'Moved tab GitHub within Now Open.'
    )
    expect(describeDropCommitted({ ...base, active: { type: 'tab', id: 'gone' }, sideEffects: [] })).toBe('Dropped.')
  })
})

describe('plural (shared by the pointer announcements and keyboard move mode)', () => {
  it('counts tabs, windows and groups with the right noun', () => {
    expect(plural(1, 'tab')).toBe('1 tab')
    expect(plural(3, 'tab')).toBe('3 tabs')
    expect(plural(2, 'window')).toBe('2 windows')
    expect(plural(2, 'group')).toBe('2 groups')
  })
})
