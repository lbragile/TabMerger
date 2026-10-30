/**
 * AI Organize, the pure part: the reply sanitizer (untrusted AI output) and the transform that
 * applies the reviewed actions (merges → renames → archives → reorder, conflicts resolved by
 * skipping actions whose group is gone).
 */
import { describe, it, expect } from 'vitest'
import type { OrganizeAction } from '@tabmerger/shared'
import { applyOrganizeActions, retargetUrlRules, sanitizeOrganizeActions, MAX_ORGANIZE_ACTIONS } from '@/lib/organizeActions'
import type { Group, GroupsState, Tab, UrlRule, Window as ExtWindow } from '@/lib/types'

const NOW = 5000
const tab = (title: string): Tab => ({ id: 0, title, url: `https://example.com/${title}`, savedAt: 1 })
const win = (name: string, tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow => ({ id: 0, name, tabs, incognito: false, focused: false, starred: false, ...over })
const group = (id: string, over: Partial<Group> = {}): Group => ({
  id,
  name: id.toUpperCase(),
  color: 'rgba(0,0,0,1)',
  updatedAt: 1,
  windows: [win(`${id}-w`, [tab(`${id}1`)])],
  ...over
})

function seed(): GroupsState {
  return {
    active: { id: 'now', index: 0 },
    available: [
      group('now', { permanent: true, name: 'Now Open' }),
      group('a', { note: 'a note' }),
      group('b', { note: 'b note', color: 'rgba(1,2,3,1)' }),
      group('c'),
      group('old', { archived: true }),
      group('demo', { tourDemo: true })
    ]
  }
}

const ids = (s: GroupsState) => s.available.map((g) => g.id)
const byId = (s: GroupsState, id: string) => s.available.find((g) => g.id === id) as Group

describe('sanitizeOrganizeActions', () => {
  const groups = seed().available

  it('keeps every well-formed action on known saved groups', () => {
    const reply = {
      actions: [
        { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' },
        { type: 'rename', groupId: 'c', newName: 'Research' },
        { type: 'delete', groupId: 'b' },
        { type: 'reorder', groupIds: ['c', 'a', 'b'] }
      ]
    }
    expect(sanitizeOrganizeActions(reply, groups)).toEqual(reply.actions)
  })

  it.each([
    ['not an object', 'nope'],
    ['null', null],
    ['no actions array', { actions: 'merge everything' }],
    ['the old run hand-off reply', { runId: '1', token: 't' }]
  ])('returns no actions for a reply that is %s', (_n, reply) => {
    expect(sanitizeOrganizeActions(reply, groups)).toEqual([])
  })

  it('returns no actions without local groups', () => {
    expect(sanitizeOrganizeActions({ actions: [{ type: 'delete', groupId: 'a' }] }, undefined)).toEqual([])
  })

  it('drops malformed actions and unknown types', () => {
    const reply = {
      actions: [
        null,
        42,
        { type: 'explode', groupId: 'a' },
        { type: 'merge', sourceGroupId: 'a' },
        { type: 'merge', sourceGroupId: 'a', targetGroupId: 'a' },
        { type: 'rename', groupId: 'a', newName: 7 },
        { type: 'rename', groupId: 'a', newName: '   \n ' },
        { type: 'delete', groupId: { id: 'a' } },
        { type: 'delete', groupId: 'x'.repeat(65) },
        { type: 'reorder', groupIds: 'a,b' },
        { type: 'reorder', groupIds: ['a'] }
      ]
    }
    expect(sanitizeOrganizeActions(reply, groups)).toEqual([])
  })

  it('drops unknown ids, Now Open, the tour practice groups and archived groups where it makes no sense', () => {
    const reply = {
      actions: [
        { type: 'merge', sourceGroupId: 'gone', targetGroupId: 'a' },
        { type: 'merge', sourceGroupId: 'now', targetGroupId: 'a' },
        { type: 'merge', sourceGroupId: 'a', targetGroupId: 'now' },
        { type: 'merge', sourceGroupId: 'demo', targetGroupId: 'a' },
        { type: 'merge', sourceGroupId: 'old', targetGroupId: 'a' },
        { type: 'rename', groupId: 'now', newName: 'Mine' },
        { type: 'rename', groupId: 'demo', newName: 'Mine' },
        { type: 'delete', groupId: 'now' },
        { type: 'delete', groupId: 'demo' },
        { type: 'delete', groupId: 'old' },
        { type: 'delete', groupId: 'gone' }
      ]
    }
    expect(sanitizeOrganizeActions(reply, groups)).toEqual([])
  })

  it('cleans names like Name group, and drops a rename to the current name', () => {
    const reply = {
      actions: [
        { type: 'rename', groupId: 'a', newName: '  Deep\n\tWork  ' },
        { type: 'rename', groupId: 'b', newName: 'B' },
        { type: 'rename', groupId: 'c', newName: 'x'.repeat(300) }
      ]
    }
    expect(sanitizeOrganizeActions(reply, groups)).toEqual([
      { type: 'rename', groupId: 'a', newName: 'Deep Work' },
      { type: 'rename', groupId: 'c', newName: 'x'.repeat(100) }
    ])
  })

  it('cleans a reorder (unknown, Now Open, archived and repeated ids out) and drops one that changes nothing', () => {
    expect(sanitizeOrganizeActions({ actions: [{ type: 'reorder', groupIds: ['now', 'c', 'gone', 'old', 'c', 'a', 7] }] }, groups)).toEqual([
      { type: 'reorder', groupIds: ['c', 'a'] }
    ])
    expect(sanitizeOrganizeActions({ actions: [{ type: 'reorder', groupIds: ['a', 'c'] }] }, groups)).toEqual([])
  })

  it('keeps only the first of repeated actions (one merge per source, one rename per group, one reorder)', () => {
    const reply = {
      actions: [
        { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' },
        { type: 'merge', sourceGroupId: 'a', targetGroupId: 'c' },
        { type: 'rename', groupId: 'b', newName: 'One' },
        { type: 'rename', groupId: 'b', newName: 'Two' },
        { type: 'delete', groupId: 'c' },
        { type: 'delete', groupId: 'c' },
        { type: 'reorder', groupIds: ['c', 'b'] },
        { type: 'reorder', groupIds: ['b', 'a'] }
      ]
    }
    expect(sanitizeOrganizeActions(reply, groups)).toEqual([
      { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' },
      { type: 'rename', groupId: 'b', newName: 'One' },
      { type: 'delete', groupId: 'c' },
      { type: 'reorder', groupIds: ['c', 'b'] }
    ])
  })

  it(`reads at most ${MAX_ORGANIZE_ACTIONS} reply items`, () => {
    const many = Array.from({ length: MAX_ORGANIZE_ACTIONS + 5 }, () => ({ type: 'explode' }))
    many.push({ type: 'delete', groupId: 'a' } as never)
    expect(sanitizeOrganizeActions({ actions: many }, groups)).toEqual([])
  })
})

describe('applyOrganizeActions', () => {
  it('merges: the target keeps its name, colour and note, gains the windows (starred first), the source is removed', () => {
    const state = seed()
    byId(state, 'a').windows = [win('a-w', [tab('a1')]), win('a-star', [tab('a2')], { starred: true })]
    const { state: next, applied, mergedInto } = applyOrganizeActions(state, [{ type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' }], NOW)
    expect(ids(next)).toEqual(['now', 'b', 'c', 'old', 'demo'])
    const b = byId(next, 'b')
    expect(b).toMatchObject({ name: 'B', color: 'rgba(1,2,3,1)', note: 'b note', updatedAt: NOW, pendingSync: true })
    expect(b.windows.map((w) => w.name)).toEqual(['a-star', 'b-w', 'a-w'])
    expect(b.info).toBeDefined()
    expect(applied).toHaveLength(1)
    expect(mergedInto).toEqual({ a: 'b' })
  })

  it('renames and stamps the group for sync', () => {
    const { state: next } = applyOrganizeActions(seed(), [{ type: 'rename', groupId: 'c', newName: '  Reading  list ' }], NOW)
    expect(byId(next, 'c')).toMatchObject({ name: 'Reading list', updatedAt: NOW, pendingSync: true })
  })

  it('applies delete as ARCHIVE: the group stays, flagged archived and pending sync', () => {
    const { state: next, archivedIds } = applyOrganizeActions(seed(), [{ type: 'delete', groupId: 'c' }], NOW)
    expect(ids(next)).toContain('c')
    expect(byId(next, 'c')).toMatchObject({ archived: true, updatedAt: NOW, pendingSync: true })
    expect(byId(next, 'c').windows).toHaveLength(1)
    expect(archivedIds).toEqual(['c'])
  })

  it('reorders the listed groups within their own slots; Now Open and unlisted groups stay put', () => {
    const { state: next } = applyOrganizeActions(seed(), [{ type: 'reorder', groupIds: ['c', 'a'] }], NOW)
    expect(ids(next)).toEqual(['now', 'c', 'b', 'a', 'old', 'demo'])
    // A reorder is not a content change: the write flags the position, no new updatedAt
    expect(byId(next, 'c').updatedAt).toBe(1)
  })

  it('never touches Now Open, the tour practice groups, unknown ids or archived merge groups', () => {
    const state = seed()
    const actions = [
      { type: 'merge', sourceGroupId: 'now', targetGroupId: 'a' },
      { type: 'merge', sourceGroupId: 'a', targetGroupId: 'now' },
      { type: 'merge', sourceGroupId: 'demo', targetGroupId: 'a' },
      { type: 'merge', sourceGroupId: 'old', targetGroupId: 'a' },
      { type: 'merge', sourceGroupId: 'gone', targetGroupId: 'a' },
      { type: 'rename', groupId: 'now', newName: 'Mine' },
      { type: 'delete', groupId: 'now' },
      { type: 'delete', groupId: 'demo' },
      { type: 'delete', groupId: 'old' },
      { type: 'reorder', groupIds: ['demo', 'now'] },
      { type: 'reorder', groupIds: 'nope' }
    ] as unknown as OrganizeAction[]
    const result = applyOrganizeActions(state, actions, NOW)
    expect(result.applied).toEqual([])
    expect(result.state).toBe(state)
  })

  it('returns the same state when nothing applies (no write)', () => {
    const state = seed()
    expect(applyOrganizeActions(state, [], NOW).state).toBe(state)
    expect(applyOrganizeActions(state, [{ type: 'rename', groupId: 'a', newName: 'A' }], NOW).state).toBe(state)
  })

  it('does not change the state it was given', () => {
    const state = seed()
    const copy = structuredClone(state)
    applyOrganizeActions(state, [{ type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' }, { type: 'reorder', groupIds: ['c', 'b'] }], NOW)
    expect(state).toEqual(copy)
  })

  describe('conflicting actions (merges → renames → archives → reorder)', () => {
    it('applies in that order whatever order they come in', () => {
      const { applied } = applyOrganizeActions(
        seed(),
        [
          { type: 'reorder', groupIds: ['c', 'b'] },
          { type: 'delete', groupId: 'c' },
          { type: 'rename', groupId: 'b', newName: 'Both' },
          { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' }
        ],
        NOW
      )
      expect(applied.map((a) => a.type)).toEqual(['merge', 'rename', 'delete'])
      // (the reorder lost c to the archive and has one group left: skipped)
    })

    it('skips a rename of a merged-away group and renames a merge target', () => {
      const { state: next, applied } = applyOrganizeActions(
        seed(),
        [
          { type: 'rename', groupId: 'a', newName: 'Lost' },
          { type: 'rename', groupId: 'b', newName: 'Kept' },
          { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' }
        ],
        NOW
      )
      expect(applied.map((a) => a.type)).toEqual(['merge', 'rename'])
      expect(byId(next, 'b').name).toBe('Kept')
      expect(next.available.some((g) => g.name === 'Lost')).toBe(false)
    })

    it('skips an archive of a merged-away group; archiving a merge target keeps the merged tabs (archived, not lost)', () => {
      const { state: next, applied } = applyOrganizeActions(
        seed(),
        [
          { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' },
          { type: 'delete', groupId: 'a' },
          { type: 'delete', groupId: 'b' }
        ],
        NOW
      )
      expect(applied).toEqual([
        { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' },
        { type: 'delete', groupId: 'b' }
      ])
      expect(byId(next, 'b').archived).toBe(true)
      expect(byId(next, 'b').windows.flatMap((w) => w.tabs.map((t) => t.title))).toEqual(['b1', 'a1'])
    })

    it('follows a merge chain: A into B, then B into C lands everything in C', () => {
      const { state: next, mergedInto } = applyOrganizeActions(
        seed(),
        [
          { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' },
          { type: 'merge', sourceGroupId: 'b', targetGroupId: 'c' }
        ],
        NOW
      )
      expect(ids(next)).toEqual(['now', 'c', 'old', 'demo'])
      expect(byId(next, 'c').windows.flatMap((w) => w.tabs.map((t) => t.title))).toEqual(['c1', 'b1', 'a1'])
      expect(mergedInto).toEqual({ a: 'c', b: 'c' })
    })

    it('sends a merge into a merged-away target on to where that target went', () => {
      const { state: next, mergedInto } = applyOrganizeActions(
        seed(),
        [
          { type: 'merge', sourceGroupId: 'b', targetGroupId: 'c' },
          { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' }
        ],
        NOW
      )
      expect(ids(next)).toEqual(['now', 'c', 'old', 'demo'])
      expect(mergedInto).toEqual({ a: 'c', b: 'c' })
    })

    it('skips a merge back into a group already merged away (no cycle) and a second merge of the same source', () => {
      const { applied, mergedInto } = applyOrganizeActions(
        seed(),
        [
          { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' },
          { type: 'merge', sourceGroupId: 'b', targetGroupId: 'a' },
          { type: 'merge', sourceGroupId: 'a', targetGroupId: 'c' }
        ],
        NOW
      )
      expect(applied).toHaveLength(1)
      expect(mergedInto).toEqual({ a: 'b' })
    })

    it('drops merged-away and archived groups out of the reorder', () => {
      const { state: next } = applyOrganizeActions(
        seed(),
        [
          { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' },
          { type: 'reorder', groupIds: ['c', 'a', 'b'] }
        ],
        NOW
      )
      expect(ids(next)).toEqual(['now', 'c', 'b', 'old', 'demo'])
    })
  })

  it('moves the active group with its tabs through a merge and its position through a reorder', () => {
    const state = { ...seed(), active: { id: 'a', index: 1 } }
    const merged = applyOrganizeActions(state, [{ type: 'merge', sourceGroupId: 'a', targetGroupId: 'c' }], NOW).state
    expect(merged.active).toEqual({ id: 'c', index: 2 })
    const reordered = applyOrganizeActions(state, [{ type: 'reorder', groupIds: ['c', 'a'] }], NOW).state
    expect(reordered.active).toEqual({ id: 'a', index: 3 })
  })
})

describe('retargetUrlRules', () => {
  const rule = (id: string, groupId: string): UrlRule => ({ id, pattern: `${id}.com/*`, groupId, createdAt: 1 })

  it('points rules of merged-away groups at the merge target and leaves the rest alone', () => {
    expect(retargetUrlRules([rule('r1', 'a'), rule('r2', 'c'), rule('r3', 'b')], { a: 'c', b: 'c' })).toEqual([
      rule('r1', 'c'),
      rule('r2', 'c'),
      rule('r3', 'c')
    ])
  })

  it('is null when no rule changes (nothing to write)', () => {
    expect(retargetUrlRules([rule('r1', 'c')], { a: 'c' })).toBeNull()
    expect(retargetUrlRules([], { a: 'c' })).toBeNull()
    expect(retargetUrlRules('corrupt' as never, { a: 'c' })).toBeNull()
  })

  it('ignores inherited keys of the mapping', () => {
    expect(retargetUrlRules([rule('r1', 'toString')], {})).toBeNull()
  })
})
