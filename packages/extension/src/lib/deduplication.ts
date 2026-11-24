import type { Tab } from '@tabmerger/shared'

/** The form two addresses are compared in when looking for duplicates (also auto-save's "already saved" check). */
export function normalizeUrl(url: string): string {
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

/**
 * The windows of a merge with their duplicate tabs removed, for "Auto-deduplicate on merge".
 * Duplicates are found by {@link findDuplicateTabs} over `kept` then `added` in reading order, so
 * a tab the group already had (`kept`) stays and the incoming copy of it (`added`) is the one
 * removed: the group keeps its notes, reminders and saved dates. A window that only held
 * duplicates is dropped; a window that was already empty stays, as it was. Windows with nothing
 * removed are returned as the same objects.
 */
export function dedupeMergedWindows<W extends { tabs: Tab[] }>(kept: W[], added: W[] = []): { kept: W[]; added: W[] } {
  const all = [...kept, ...added]
  const drop = new Set(findDuplicateTabs(all).map((d) => `${d.windowIndex}:${d.tabIndex}`))
  if (drop.size === 0) return { kept, added }
  const result = all.flatMap((w, wi): { w: W; wi: number }[] => {
    if (!w.tabs.some((_, ti) => drop.has(`${wi}:${ti}`))) return [{ w, wi }]
    const tabs = w.tabs.filter((_, ti) => !drop.has(`${wi}:${ti}`))
    return tabs.length > 0 ? [{ w: { ...w, tabs }, wi }] : []
  })
  return {
    kept: result.filter((r) => r.wi < kept.length).map((r) => r.w),
    added: result.filter((r) => r.wi >= kept.length).map((r) => r.w)
  }
}
