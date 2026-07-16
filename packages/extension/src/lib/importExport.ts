import type { Group } from '@tabmerger/shared'
import { createGroup, createWindow, createTab } from '@/lib/utils'

export function exportGroups(groups: Group[]): string {
  return JSON.stringify(groups)
}

export function importGroups(json: string): Group[] {
  const parsed: unknown = JSON.parse(json) // throws on invalid JSON
  if (!Array.isArray(parsed)) throw new Error('Expected an array')
  return parsed.map((item: unknown, i) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('id' in item) ||
      !('name' in item) ||
      !('windows' in item)
    ) {
      throw new Error(`Item at index ${i} is missing required fields (id, name, windows)`)
    }
    return item as Group
  })
}

export function parseBookmarksHtml(html: string): Group[] {
  // Parse with DOMParser — available in extension popup context; in tests uses jsdom
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const groups: Group[] = []

  function collectTabs(dl: Element): ReturnType<typeof createTab>[] {
    const tabs: ReturnType<typeof createTab>[] = []
    for (const dt of Array.from(dl.children)) {
      if (dt.tagName !== 'DT') continue
      const a = dt.querySelector(':scope > a')
      const h3 = dt.querySelector(':scope > h3')
      if (a) {
        const url = a.getAttribute('href') ?? ''
        const title = a.textContent?.trim() ?? url
        const tab = createTab(title, url)
        tabs.push(tab)
      } else if (h3) {
        // nested folder — flatten its tabs into this level
        const nestedDl = dt.querySelector(':scope > dl')
        if (nestedDl) tabs.push(...collectTabs(nestedDl))
      }
    }
    return tabs
  }

  // Top-level DL
  const topDl = doc.querySelector('dl')
  if (!topDl) return groups

  for (const dt of Array.from(topDl.children)) {
    if (dt.tagName !== 'DT') continue
    const h3 = dt.querySelector(':scope > h3')
    if (!h3) continue
    const name = h3.textContent?.trim() ?? 'Imported'
    const dl = dt.querySelector(':scope > dl')
    const tabs = dl ? collectTabs(dl) : []
    if (tabs.length === 0) continue
    const g = createGroup(undefined, name)
    g.windows = [createWindow(tabs)]
    groups.push(g)
  }

  return groups
}

export function parseOneTabs(text: string): Group[] {
  const groups: Group[] = []
  let n = 0
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) continue
    const tabs = lines.map((line) => {
      const sep = line.indexOf(' | ')
      const url = sep === -1 ? line : line.slice(0, sep).trim()
      const title = sep === -1 ? line : line.slice(sep + 3).trim()
      return createTab(title, url)
    })
    n++
    const g = createGroup(undefined, `Imported ${n}`)
    g.windows = [createWindow(tabs)]
    groups.push(g)
  }
  return groups
}
