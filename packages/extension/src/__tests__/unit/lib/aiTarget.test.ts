import { describe, it, expect } from 'vitest'
import {
  aiTargetModalData,
  groupSubject,
  readAiTarget,
  resolveAiTarget,
  subjectBlock,
  windowSubject,
  windowTabsKey,
  type AiTarget,
} from '@/lib/aiTarget'
import type { Group, GroupsState, Window } from '@/lib/types'

/**
 * Where an AI "Name" / "Describe" result goes: a group by id, or a window found again by its
 * position and the tabs it held when the request was sent (windows have no id of their own).
 */

const tab = (title: string) => ({ id: 0, title, url: `https://${title.toLowerCase()}.example.com` })
const win = (titles: string[], overrides: Partial<Window> = {}): Window => ({
  id: 0, tabs: titles.map(tab), incognito: false, focused: false, ...overrides,
})
const group = (overrides: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Research', color: 'rgba(0,0,0,1)', updatedAt: 1, windows: [win(['A', 'B']), win(['C'])], ...overrides,
})
const state = (...groups: Group[]): GroupsState => ({ active: { id: groups[0]?.id ?? '', index: 0 }, available: groups })

describe('windowTabsKey', () => {
  it('is the same for the same tabs in another order (a sort keeps the tabs)', () => {
    expect(windowTabsKey(win(['A', 'B']))).toBe(windowTabsKey(win(['B', 'A'])))
  })

  it('differs when a tab was added, removed or swapped', () => {
    const key = windowTabsKey(win(['A', 'B']))
    expect(windowTabsKey(win(['A']))).not.toBe(key)
    expect(windowTabsKey(win(['A', 'B', 'C']))).not.toBe(key)
    expect(windowTabsKey(win(['A', 'C']))).not.toBe(key)
  })

  it('skips holes in a tabs array', () => {
    const holey = { tabs: [tab('A'), undefined as never, tab('B')] }
    expect(windowTabsKey(holey)).toBe(windowTabsKey(win(['A', 'B'])))
  })
})

describe('subjects', () => {
  it('a group: its id, name and every tab', () => {
    expect(groupSubject(group())).toEqual({
      target: { kind: 'group', groupId: 'g1' }, name: 'Research', tabs: [tab('A'), tab('B'), tab('C')], permanent: false,
    })
    expect(groupSubject(undefined)).toBeUndefined()
  })

  it('a window: its group id, position, tabs key, own name ("" when unnamed) and only its tabs', () => {
    const g = group({ windows: [win(['A']), win(['B', 'C'], { name: 'Reading' })] })
    expect(windowSubject(g, 1, g.windows[1])).toEqual({
      target: { kind: 'window', groupId: 'g1', windowIndex: 1, tabsKey: windowTabsKey(g.windows[1]) },
      name: 'Reading', tabs: [tab('B'), tab('C')], permanent: false,
    })
    expect(windowSubject(g, 0, g.windows[0])?.name).toBe('')
    expect(windowSubject(undefined, 0, g.windows[0])).toBeUndefined()
    expect(windowSubject(g, 5, undefined)).toBeUndefined()
  })

  it.each([
    ['nothing', undefined, 'notSaved'],
    ['a Now Open window', windowSubject(group({ permanent: true }), 0, win(['A'])), 'notSaved'],
    ['an empty window', windowSubject(group(), 0, win([])), 'noTabs'],
    ['a saved window with tabs', windowSubject(group(), 0, win(['A'])), null],
    ['a saved group with tabs', groupSubject(group()), null],
  ] as const)('%s → block %s', (_label, subject, block) => {
    expect(subjectBlock(subject)).toBe(block)
  })
})

describe('resolveAiTarget', () => {
  const g = group({ note: 'G note', windows: [win(['A', 'B'], { name: 'One', note: 'W note' }), win(['C'])] })
  const target: AiTarget = { kind: 'window', groupId: 'g1', windowIndex: 0, tabsKey: windowTabsKey(g.windows[0]) }

  it('a group by id, wherever it is now, with its name and note', () => {
    const found = resolveAiTarget(state(group({ id: 'x' }), g), { kind: 'group', groupId: 'g1' })
    expect(found).toMatchObject({ groupIndex: 1, windowIndex: null, window: null, name: 'Research', note: 'G note' })
  })

  it('a window still at its position with the same tabs, with ITS name and note', () => {
    expect(resolveAiTarget(state(g), target)).toMatchObject({ groupIndex: 0, windowIndex: 0, name: 'One', note: 'W note' })
  })

  it('a window that moved is found by its tabs when exactly one window holds them', () => {
    const moved = group({ windows: [win(['C']), win(['B', 'A'], { name: 'One' })] })
    expect(resolveAiTarget(state(moved), target)).toMatchObject({ windowIndex: 1, name: 'One', note: '' })
  })

  it.each([
    ['the group is gone', state(group({ id: 'other' }))],
    ['the window is gone', state(group({ windows: [win(['C'])] }))],
    ['its tabs changed', state(group({ windows: [win(['A']), win(['C'])] }))],
    ['two windows now hold those tabs, neither at the old position', state(group({ windows: [win(['C']), win(['A', 'B']), win(['A', 'B'])] }))],
    ['no state', undefined],
  ])('null when %s', (_label, s) => {
    expect(resolveAiTarget(s, target)).toBeNull()
  })

  it('null for no target', () => {
    expect(resolveAiTarget(state(g), null)).toBeNull()
  })
})

describe('readAiTarget / aiTargetModalData', () => {
  it('round-trips a group and a window target', () => {
    const groupTarget: AiTarget = { kind: 'group', groupId: 'g1' }
    const windowTarget: AiTarget = { kind: 'window', groupId: 'g1', windowIndex: 2, tabsKey: '["x"]' }
    expect(aiTargetModalData(groupTarget, { description: 'D' })).toEqual({ groupId: 'g1', description: 'D' })
    expect(readAiTarget(aiTargetModalData(groupTarget, {}))).toEqual(groupTarget)
    expect(readAiTarget(aiTargetModalData(windowTarget, { suggestions: [] }))).toEqual(windowTarget)
  })

  it.each([
    ['no group id', {}],
    ['an empty group id', { groupId: '' }],
    ['a non-string group id', { groupId: 5 }],
    ['window not an object', { groupId: 'g1', window: 'x' }],
    ['window null', { groupId: 'g1', window: null }],
    ['a fractional index', { groupId: 'g1', window: { index: 1.5, tabsKey: '[]' } }],
    ['a negative index', { groupId: 'g1', window: { index: -1, tabsKey: '[]' } }],
    ['no tabs key', { groupId: 'g1', window: { index: 0 } }],
  ])('null for %s (a broken window target never becomes the whole group)', (_label, data) => {
    expect(readAiTarget(data as Record<string, unknown>)).toBeNull()
  })
})
