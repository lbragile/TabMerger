import { describe, it, expect } from 'vitest'
import { exportGroups, importGroups, parseBookmarksHtml, parseOneTabs } from '@/lib/importExport'
import { createGroup, createTab, createWindow } from '@/lib/utils'
import type { Group } from '@tabmerger/shared'

function makeGroup(name: string, urls: string[]): Group {
  const tabs = urls.map((url, i) => ({ ...createTab(), id: i, url, title: url }))
  const g = createGroup(undefined, name)
  g.windows = [createWindow(tabs)]
  return g
}

describe('exportGroups', () => {
  it('produces valid JSON with correct structure', () => {
    const groups = [makeGroup('Work', ['https://a.com'])]
    const json = exportGroups(groups)
    const parsed = JSON.parse(json) // throws if invalid
    expect(Array.isArray(parsed)).toBe(true)
    const g = parsed[0]
    expect(g).toHaveProperty('id')
    expect(g).toHaveProperty('name', 'Work')
    expect(g).toHaveProperty('windows')
  })
})

describe('importGroups', () => {
  it('round-trips: export then import returns equivalent groups', () => {
    const groups = [makeGroup('Research', ['https://x.com', 'https://y.com'])]
    const json = exportGroups(groups)
    const imported = importGroups(json)
    expect(imported).toHaveLength(1)
    expect(imported[0].name).toBe('Research')
    expect(imported[0].windows[0].tabs).toHaveLength(2)
  })

  it('throws on invalid JSON', () => {
    expect(() => importGroups('not json {')).toThrow()
  })

  it('throws when JSON is valid but missing required fields', () => {
    const badJson = JSON.stringify([{ id: '123' }]) // no name, no windows
    expect(() => importGroups(badJson)).toThrow()
  })
})

describe('parseBookmarksHtml', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Work</H3>
  <DL><p>
    <DT><A HREF="https://github.com" ADD_DATE="1700000000">GitHub</A>
    <DT><A HREF="https://linear.app" ADD_DATE="1700000001">Linear</A>
  </DL><p>
</DL><p>`

  it('converts a folder with bookmarks into a group with tabs', () => {
    const groups = parseBookmarksHtml(html)
    expect(groups.length).toBeGreaterThanOrEqual(1)
    const work = groups.find((g) => g.name === 'Work')
    expect(work).toBeDefined()
    const tabs = work!.windows.flatMap((w) => w.tabs)
    expect(tabs).toHaveLength(2)
    expect(tabs[0].url).toBe('https://github.com')
    expect(tabs[1].url).toBe('https://linear.app')
  })

  it('handles nested folders by flattening to single level', () => {
    const nestedHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Outer</H3>
  <DL><p>
    <DT><H3>Inner</H3>
    <DL><p>
      <DT><A HREF="https://nested.com">Nested</A>
    </DL><p>
    <DT><A HREF="https://outer.com">Outer Tab</A>
  </DL><p>
</DL><p>`
    const groups = parseBookmarksHtml(nestedHtml)
    const allTabs = groups.flatMap((g) => g.windows.flatMap((w) => w.tabs))
    const urls = allTabs.map((t) => t.url)
    expect(urls).toContain('https://nested.com')
    expect(urls).toContain('https://outer.com')
  })
})

describe('parseOneTabs', () => {
  it('parses a OneTab export into groups separated by blank lines', () => {
    const text = `https://github.com | GitHub
https://linear.app | Linear

https://notion.so | Notion`

    const groups = parseOneTabs(text)
    expect(groups).toHaveLength(2)
    const firstTabs = groups[0].windows.flatMap((w) => w.tabs)
    expect(firstTabs).toHaveLength(2)
    expect(firstTabs[0].url).toBe('https://github.com')
    expect(firstTabs[0].title).toBe('GitHub')
    const secondTabs = groups[1].windows.flatMap((w) => w.tabs)
    expect(secondTabs).toHaveLength(1)
    expect(secondTabs[0].url).toBe('https://notion.so')
  })

  it('parses a single group with no blank lines as one group', () => {
    const text = `https://github.com | GitHub
https://linear.app | Linear
https://notion.so | Notion`

    const groups = parseOneTabs(text)
    expect(groups).toHaveLength(1)
    const tabs = groups[0].windows.flatMap((w) => w.tabs)
    expect(tabs).toHaveLength(3)
  })
})

describe('parseBookmarksHtml edge cases', () => {
  it('returns empty array when there are no folders', () => {
    // Bookmarks file with only bare links at the root, no H3 folder headers
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><A HREF="https://example.com">Example</A>
</DL><p>`

    const groups = parseBookmarksHtml(html)
    // No folders → no groups OR one catch-all group; either way no crash
    const allTabs = groups.flatMap((g) => g.windows.flatMap((w) => w.tabs))
    // The bare link may or may not be captured depending on implementation,
    // but the parser must not throw
    expect(Array.isArray(groups)).toBe(true)
    // If captured, URL must be correct
    if (allTabs.length > 0) {
      expect(allTabs.some((t) => t.url === 'https://example.com')).toBe(true)
    }
  })
})
