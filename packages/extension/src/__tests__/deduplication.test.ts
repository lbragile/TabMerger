import { describe, it, expect } from 'vitest'
import { deduplicateTabs } from '@/lib/deduplication'
import type { Tab } from '@tabmerger/shared'

function makeTab(id: number, url: string, title = 'Tab'): Tab {
  return { id, url, title, pinned: false }
}

describe('deduplicateTabs', () => {
  it('returns empty duplicates array when all URLs are unique', () => {
    const tabs = [
      makeTab(1, 'https://a.com'),
      makeTab(2, 'https://b.com'),
      makeTab(3, 'https://c.com'),
    ]
    const { keep, duplicates } = deduplicateTabs(tabs)
    expect(duplicates).toHaveLength(0)
    expect(keep).toHaveLength(3)
  })

  it('identifies duplicates correctly — keeps first occurrence, marks rest as duplicates', () => {
    const tabs = [
      makeTab(1, 'https://a.com'),
      makeTab(2, 'https://a.com'),
      makeTab(3, 'https://b.com'),
    ]
    const { keep, duplicates } = deduplicateTabs(tabs)
    expect(keep).toHaveLength(2)
    expect(keep[0].id).toBe(1)
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0].id).toBe(2)
  })

  it('treats tabs with the same URL but different titles as duplicates', () => {
    const tabs = [
      makeTab(1, 'https://a.com', 'Title A'),
      makeTab(2, 'https://a.com', 'Title B'),
    ]
    const { duplicates } = deduplicateTabs(tabs)
    expect(duplicates).toHaveLength(1)
  })

  it('returns correct counts across multiple duplicates', () => {
    const tabs = [
      makeTab(1, 'https://a.com'),
      makeTab(2, 'https://a.com'),
      makeTab(3, 'https://a.com'),
      makeTab(4, 'https://b.com'),
      makeTab(5, 'https://b.com'),
    ]
    const { keep, duplicates } = deduplicateTabs(tabs)
    expect(keep).toHaveLength(2)
    expect(duplicates).toHaveLength(3)
  })

  it('returns empty arrays when tabs is empty', () => {
    const { keep, duplicates } = deduplicateTabs([])
    expect(keep).toHaveLength(0)
    expect(duplicates).toHaveLength(0)
  })
})
