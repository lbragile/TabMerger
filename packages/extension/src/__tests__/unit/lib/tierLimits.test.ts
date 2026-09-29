import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exceedsFreeLimits, countSavedGroupsAndTabs, showFreeLimitToast, blockImportOverFreeLimit } from '@/lib/tierLimits'
import type { Group } from '@/lib/types'

const { mockToastError, mockTrackEvent } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockTrackEvent: vi.fn(),
}))

vi.mock('@/lib/toast', () => ({ toast: { error: mockToastError } }))
vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 'g',
    name: 'g',
    color: 'rgba(0,0,0,1)',
    updatedAt: 0,
    windows: [],
    ...overrides,
  }
}

describe('exceedsFreeLimits', () => {
  it('is not exceeded when counts are exactly at the limit', () => {
    expect(exceedsFreeLimits({ maxGroups: 5 }, { groups: 5 })).toEqual({ exceeded: false })
  })

  it('is exceeded when a count goes one over the limit', () => {
    expect(exceedsFreeLimits({ maxGroups: 5 }, { groups: 6 })).toEqual({ exceeded: true, limit: 'maxGroups', maxAllowed: 5 })
  })

  it('checks groups before tabs before urlRules, reporting the first violation', () => {
    const result = exceedsFreeLimits({ maxGroups: 5, maxTabs: 50 }, { groups: 6, tabs: 100 })
    expect(result.exceeded && result.limit).toBe('maxGroups')
  })

  it('reports maxTabs when only tabs are over', () => {
    const result = exceedsFreeLimits({ maxGroups: 5, maxTabs: 50 }, { groups: 3, tabs: 51 })
    expect(result).toEqual({ exceeded: true, limit: 'maxTabs', maxAllowed: 50 })
  })

  it('reports maxUrlRules when only urlRules are over', () => {
    const result = exceedsFreeLimits({ maxUrlRules: 3 }, { urlRules: 4 })
    expect(result).toEqual({ exceeded: true, limit: 'maxUrlRules', maxAllowed: 3 })
  })

  it('never exceeds for Infinity caps (paid tiers)', () => {
    expect(exceedsFreeLimits({ maxGroups: Infinity, maxTabs: Infinity, maxUrlRules: Infinity }, { groups: 999, tabs: 999, urlRules: 999 }).exceeded).toBe(false)
  })

  it('skips a check when the cap is not provided, even if the count is', () => {
    expect(exceedsFreeLimits({}, { groups: 999 }).exceeded).toBe(false)
  })

  it('skips a check when the count is not provided, even if the cap is', () => {
    expect(exceedsFreeLimits({ maxGroups: 5 }, {}).exceeded).toBe(false)
  })
})

describe('countSavedGroupsAndTabs', () => {
  it('excludes the permanent Now Open group', () => {
    const groups = [
      group({ id: 'now-open', permanent: true, windows: [{ id: 1, tabs: [{}, {}] as never[], incognito: false, focused: false }] }),
      group({ id: 'saved', windows: [{ id: 2, tabs: [{}] as never[], incognito: false, focused: false }] }),
    ]
    expect(countSavedGroupsAndTabs(groups)).toEqual({ groups: 1, tabs: 1 })
  })

  it('includes archived groups in the count (archiving does not free a slot)', () => {
    const groups = [
      group({ id: 'a', archived: true, windows: [{ id: 1, tabs: [{}] as never[], incognito: false, focused: false }] }),
      group({ id: 'b', windows: [{ id: 2, tabs: [{}] as never[], incognito: false, focused: false }] }),
    ]
    expect(countSavedGroupsAndTabs(groups)).toEqual({ groups: 2, tabs: 2 })
  })

  it('sums tabs across multiple windows per group', () => {
    const groups = [
      group({
        windows: [
          { id: 1, tabs: [{}, {}] as never[], incognito: false, focused: false },
          { id: 2, tabs: [{}] as never[], incognito: false, focused: false },
        ],
      }),
    ]
    expect(countSavedGroupsAndTabs(groups)).toEqual({ groups: 1, tabs: 3 })
  })

  it('tolerates groups missing windows/tabs (partial import fixtures)', () => {
    const groups = [{ id: 'x' } as unknown as Group]
    expect(countSavedGroupsAndTabs(groups)).toEqual({ groups: 1, tabs: 0 })
  })

  it('returns zero counts for an empty list', () => {
    expect(countSavedGroupsAndTabs([])).toEqual({ groups: 0, tabs: 0 })
  })
})

describe('showFreeLimitToast', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fires the limit-hit tracking event and an error toast with an Upgrade action', () => {
    showFreeLimitToast('maxGroups', 5)
    expect(mockTrackEvent).toHaveBeenCalledWith('entitlement_limit_hit', { limit: 'maxGroups' })
    expect(mockToastError).toHaveBeenCalledWith(
      'Free plan allows up to 5 groups.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Upgrade' }) })
    )
  })

  it('includes an optional detail as the toast description', () => {
    showFreeLimitToast('maxUrlRules', 3, 'This file contains 4 URL rules.')
    expect(mockToastError).toHaveBeenCalledWith(
      'Free plan allows up to 3 URL rules.',
      expect.objectContaining({ description: 'This file contains 4 URL rules.' })
    )
  })
})

function groupWithTabs(id: string, tabCount: number, overrides: Partial<Group> = {}): Group {
  return group({
    id,
    windows: [{ id: 1, tabs: Array.from({ length: tabCount }, () => ({})) as never[], incognito: false, focused: false }],
    ...overrides,
  })
}

describe('blockImportOverFreeLimit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('append mode: blocks when current + imported exceeds maxGroups, toasts with file counts, no tier pre-check needed', () => {
    const current = [groupWithTabs('c1', 1), groupWithTabs('c2', 1), groupWithTabs('c3', 1), groupWithTabs('c4', 1)]
    const imported = [groupWithTabs('i1', 2)]
    const blocked = blockImportOverFreeLimit({ maxGroups: 4, maxTabs: 50 }, current, imported, 'append')
    expect(blocked).toBe(true)
    expect(mockToastError).toHaveBeenCalledWith(
      'Free plan allows up to 4 groups.',
      expect.objectContaining({ description: 'This file contains 1 group, 2 tabs.' })
    )
  })

  it('append mode: allows when current + imported is within the caps', () => {
    const current = [groupWithTabs('c1', 1)]
    const imported = [groupWithTabs('i1', 1)]
    expect(blockImportOverFreeLimit({ maxGroups: 5, maxTabs: 50 }, current, imported, 'append')).toBe(false)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('replace mode: gates on the imported file\'s own counts, ignoring "current" entirely', () => {
    const current = [groupWithTabs('c1', 1), groupWithTabs('c2', 1), groupWithTabs('c3', 1)] // would fail append math
    const imported = [groupWithTabs('i1', 1)] // but the file itself is well within the cap
    expect(blockImportOverFreeLimit({ maxGroups: 2, maxTabs: 50 }, current, imported, 'replace')).toBe(false)
  })

  it('replace mode: blocks when the imported file alone exceeds the cap', () => {
    const imported = [groupWithTabs('i1', 1), groupWithTabs('i2', 1), groupWithTabs('i3', 1)]
    expect(blockImportOverFreeLimit({ maxGroups: 2, maxTabs: 50 }, [], imported, 'replace')).toBe(true)
  })

  it('is unaffected for Pro (Infinity caps) regardless of tier — no separate tier check needed', () => {
    const current = Array.from({ length: 10 }, (_, i) => groupWithTabs(`c${i}`, 5))
    const imported = Array.from({ length: 10 }, (_, i) => groupWithTabs(`i${i}`, 5))
    expect(blockImportOverFreeLimit({ maxGroups: Infinity, maxTabs: Infinity }, current, imported, 'append')).toBe(false)
    expect(mockToastError).not.toHaveBeenCalled()
  })
})
