import { describe, it, expect, vi } from 'vitest'
import type { Group } from '@/lib/types'
import {
  emitAutoSavePromoted,
  isAutoSavedGroup,
  isRollingAutoSave,
  keepAutoSavedGroup,
  listAutoSavedGroups,
  onAutoSavePromoted,
  parseAutoSaveMarker,
  promoteEditedAutoSave,
  rollingToReplace,
} from '@/lib/autoSaveGroups'

const tab = (url: string) => ({ id: 0, title: url, url })
const group = (id: string, extra: Partial<Group> = {}): Group => ({
  id,
  name: id,
  color: 'rgba(1, 2, 3, 1)',
  updatedAt: 1,
  windows: [{ id: 1, tabs: [tab(`https://${id}.test/`)], incognito: false, focused: false }],
  ...extra,
})
const auto = (id: string, at: number, rolling: boolean, extra: Partial<Group> = {}) => group(id, { autoSave: { at, rolling }, ...extra })

describe('parseAutoSaveMarker', () => {
  it('keeps a well-formed marker only', () => {
    expect(parseAutoSaveMarker({ at: 5, rolling: true })).toEqual({ at: 5, rolling: true })
    expect(parseAutoSaveMarker({ at: 5, rolling: false, extra: 1 })).toEqual({ at: 5, rolling: false })
    for (const bad of [null, undefined, 'x', 3, {}, { at: 0, rolling: true }, { at: -1, rolling: true }, { at: NaN, rolling: true }, { at: Infinity, rolling: true }, { at: 5 }, { at: 5, rolling: 'yes' }, { at: '5', rolling: true }]) {
      expect(parseAutoSaveMarker(bad)).toBeUndefined()
    }
  })
})

describe('isAutoSavedGroup / isRollingAutoSave', () => {
  it('needs a valid marker and is never Now Open', () => {
    expect(isAutoSavedGroup(auto('a', 1, true))).toBe(true)
    expect(isAutoSavedGroup(auto('a', 1, true, { permanent: true }))).toBe(false)
    expect(isAutoSavedGroup(group('a'))).toBe(false)
    expect(isAutoSavedGroup(null)).toBe(false)
    expect(isAutoSavedGroup(group('a', { autoSave: { at: 0, rolling: true } }))).toBe(false)
  })
  it('rolling only for rolling markers', () => {
    expect(isRollingAutoSave(auto('a', 1, true))).toBe(true)
    expect(isRollingAutoSave(auto('a', 1, false))).toBe(false)
    expect(isRollingAutoSave(group('a'))).toBe(false)
  })
})

describe('listAutoSavedGroups', () => {
  it('lists auto-saves newest first with their real index; ties put the later one first', () => {
    const available = [group('now', { permanent: true }), auto('old', 10, true), group('normal'), auto('new', 30, false), auto('tie', 10, true)]
    expect(listAutoSavedGroups(available).map(({ group: g, realIndex }) => [g.id, realIndex])).toEqual([
      ['new', 3],
      ['tie', 4],
      ['old', 1],
    ])
  })
})

describe('rollingToReplace', () => {
  it('nothing while fewer than the cap exist', () => {
    expect(rollingToReplace([auto('a', 1, true)], 2)).toEqual([])
    expect(rollingToReplace([], 2)).toEqual([])
  })
  it('the oldest rolling one at the cap; never a non-rolling one', () => {
    const available = [auto('pro', 1, false), auto('b', 20, true), auto('a', 10, true), group('n')]
    expect(rollingToReplace(available, 2).map((g) => g.id)).toEqual(['a'])
  })
  it('everything beyond the newest cap-1 when somehow over the cap', () => {
    const available = [auto('a', 1, true), auto('b', 2, true), auto('c', 3, true), auto('d', 4, true)]
    expect(rollingToReplace(available, 2).map((g) => g.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('promoteEditedAutoSave', () => {
  const stored = auto('x', 100, true)

  it('drops the marker when the content changed and stamps it for sync', () => {
    vi.spyOn(Date, 'now').mockReturnValue(5000)
    const next = { ...stored, name: 'Renamed', updatedAt: 200, pendingSync: true }
    const out = promoteEditedAutoSave(stored, next)
    expect(out).not.toBeNull()
    expect(out!.autoSave).toBeUndefined()
    expect(out!.name).toBe('Renamed')
    expect(out!.pendingSync).toBe(true)
    expect(out!.updatedAt).toBe(5000)
    vi.restoreAllMocks()
  })

  it.each([
    ['a tab added', (g: Group): Group => ({ ...g, windows: [{ ...g.windows[0], tabs: [...g.windows[0].tabs, tab('https://y.test/')] }] })],
    ['a tab removed', (g: Group): Group => ({ ...g, windows: [{ ...g.windows[0], tabs: [] }] })],
    ['the colour', (g: Group): Group => ({ ...g, color: 'rgba(9, 9, 9, 1)' })],
    ['a note', (g: Group): Group => ({ ...g, note: 'hi' })],
    ['the star', (g: Group): Group => ({ ...g, starred: true })],
    ['archived', (g: Group): Group => ({ ...g, archived: true })],
  ])('counts %s as an edit', (_label, edit) => {
    const next = { ...edit(stored), pendingSync: true }
    expect(promoteEditedAutoSave(stored, next)?.autoSave).toBeUndefined()
    expect(promoteEditedAutoSave(stored, next)).not.toBeNull()
  })

  it('a pulled server copy (not pending) is never an edit, even with different content', () => {
    expect(promoteEditedAutoSave(stored, { ...stored, name: 'From another device', pendingSync: false })).toBeNull()
  })

  it('normalises the shape a pulled copy has (starred/archived false, no permanent, empty note)', () => {
    const local: Group = { ...stored, permanent: false }
    const pulledShape: Group = { ...stored, starred: false, archived: false, note: undefined, pendingSync: true }
    delete (pulledShape as { permanent?: boolean }).permanent
    expect(promoteEditedAutoSave(local, pulledShape)).toBeNull()
  })

  it('ignores sync bookkeeping, the count line and key order', () => {
    const next: Group = { pendingSync: false, info: 'other', remoteUpdatedAt: 'x', positionDirty: true, ...stored, updatedAt: 999 }
    const reordered = Object.fromEntries(Object.entries(next).reverse()) as unknown as Group
    expect(promoteEditedAutoSave(stored, reordered)).toBeNull()
  })

  it('does nothing without a stored or incoming marker, for the same object, or for Now Open', () => {
    expect(promoteEditedAutoSave(undefined, { ...stored, name: 'n', pendingSync: true })).toBeNull()
    expect(promoteEditedAutoSave(group('x'), { ...group('x'), name: 'n', autoSave: { at: 1, rolling: true }, pendingSync: true })).toBeNull()
    const { autoSave: _a, ...kept } = stored
    expect(promoteEditedAutoSave(stored, { ...kept, name: 'kept and renamed', pendingSync: true })).toBeNull()
    expect(promoteEditedAutoSave(stored, stored)).toBeNull()
    expect(promoteEditedAutoSave(stored, { ...stored, name: 'n', permanent: true, pendingSync: true })).toBeNull()
  })
})

describe('keepAutoSavedGroup', () => {
  it('removes the marker and marks it for sync, never moving updatedAt back', () => {
    const kept = keepAutoSavedGroup(auto('x', 1, true, { updatedAt: 9000 }), 100)
    expect(kept.autoSave).toBeUndefined()
    expect(kept.pendingSync).toBe(true)
    expect(kept.updatedAt).toBe(9000)
    expect(keepAutoSavedGroup(auto('x', 1, true, { updatedAt: 10 }), 100).updatedAt).toBe(100)
  })
})

describe('promotion listeners', () => {
  it('delivers to every listener, survives a throwing one, and unsubscribes', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen: string[] = []
    const off1 = onAutoSavePromoted(() => {
      throw new Error('boom')
    })
    const off2 = onAutoSavePromoted((groups) => seen.push(...groups.map((g) => g.id)))
    emitAutoSavePromoted([])
    expect(seen).toEqual([])
    emitAutoSavePromoted([group('a')])
    expect(seen).toEqual(['a'])
    expect(err).toHaveBeenCalled()
    off1()
    off2()
    emitAutoSavePromoted([group('b')])
    expect(seen).toEqual(['a'])
    err.mockRestore()
  })
})
