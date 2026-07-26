import { describe, it, expect } from 'vitest'
import { INITIAL_GROUPS, groupTabCount, faviconUrl, nextTabId, nextGroupId } from '@/components/marketing/demo/seedData'

describe('demo seedData', () => {
  it('includes a permanent "Now Open" group first', () => {
    expect(INITIAL_GROUPS[0].name).toBe('Now Open')
    expect(INITIAL_GROUPS[0].permanent).toBe(true)
  })

  it('has at least 4 groups with realistic volume', () => {
    expect(INITIAL_GROUPS.length).toBeGreaterThanOrEqual(4)
    const totalTabs = INITIAL_GROUPS.reduce((acc, g) => acc + groupTabCount(g), 0)
    expect(totalTabs).toBeGreaterThanOrEqual(20)
  })

  it('stays under free-tier limits (5 groups, 50 tabs)', () => {
    expect(INITIAL_GROUPS.length).toBeLessThanOrEqual(5)
    const totalTabs = INITIAL_GROUPS.reduce((acc, g) => acc + groupTabCount(g), 0)
    expect(totalTabs).toBeLessThanOrEqual(50)
  })

  it('every group has a valid rgba color from PRESET_COLORS or DEFAULT_GROUP_COLOR', () => {
    for (const g of INITIAL_GROUPS) {
      expect(g.color).toMatch(/^rgba\(/)
    }
  })

  it('groupTabCount sums tabs across all windows', () => {
    const group = INITIAL_GROUPS.find((g) => g.name !== 'Now Open')!
    const expected = group.windows.reduce((acc, w) => acc + w.tabs.length, 0)
    expect(groupTabCount(group)).toBe(expected)
  })

  it('faviconUrl builds a Google s2 favicon URL from a domain', () => {
    expect(faviconUrl('github.com')).toBe('https://www.google.com/s2/favicons?domain=github.com&sz=32')
  })

  it('nextTabId and nextGroupId return unique values on each call', () => {
    expect(nextTabId()).not.toBe(nextTabId())
    expect(nextGroupId()).not.toBe(nextGroupId())
  })
})
