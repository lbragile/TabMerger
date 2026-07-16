import type { Tab } from '@tabmerger/shared'

function normalizeUrl(url: string): string {
  try {
    return new URL(url).href.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

export function deduplicateTabs(tabs: Tab[]): { keep: Tab[]; duplicates: Tab[] } {
  const seen = new Set<string>()
  const keep: Tab[] = []
  const duplicates: Tab[] = []
  for (const tab of tabs) {
    const key = normalizeUrl(tab.url)
    if (seen.has(key)) {
      duplicates.push(tab)
    } else {
      seen.add(key)
      keep.push(tab)
    }
  }
  return { keep, duplicates }
}
