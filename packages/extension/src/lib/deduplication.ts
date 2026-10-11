import type { Tab } from '@tabmerger/shared'

function normalizeUrl(url: string): string {
  // a tab whose url is not a string (malformed stored data) compares as an empty address instead of throwing
  if (typeof url !== 'string') return ''
  try {
    return new URL(url).href.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

/**
 * A duplicate tab and where it sits in its group. Tabs are addressed by position
 * (`windowIndex`, `tabIndex`), never by `tab.id`: saved tabs all share `id: 0`.
 */
export interface DuplicateTab {
  windowIndex: number
  tabIndex: number
  tab: Tab
}

/**
 * The duplicate tabs of a group's windows in reading order, each with its position.
 * The first tab of every URL is the one kept, so it is never listed.
 */
export function findDuplicateTabs(windows: { tabs: Tab[] }[]): DuplicateTab[] {
  const seen = new Set<string>()
  const duplicates: DuplicateTab[] = []
  windows.forEach((w, windowIndex) => {
    w.tabs.forEach((tab, tabIndex) => {
      const key = normalizeUrl(tab.url)
      if (seen.has(key)) duplicates.push({ windowIndex, tabIndex, tab })
      else seen.add(key)
    })
  })
  return duplicates
}
