import { describe, it, expect } from 'vitest'
import {
  exportGroups,
  importGroups,
  importGroupsState,
  parseBookmarksHtml,
  parseOneTabs,
  skippedSuffix,
  IMPORTED_GROUP_FALLBACK_NAME
} from '@/lib/importExport'
import { createGroup, createTab, createWindow } from '@/lib/utils'
import { DEFAULT_GROUP_COLOR, type Group } from '@/lib/types'

function makeGroup(name: string, urls: string[]): Group {
  const tabs = urls.map((url, i) => ({ ...createTab(), id: i, url, title: url }))
  const g = createGroup(undefined, name)
  g.windows = [createWindow(tabs)]
  return g
}

/** Script-running URLs in the spellings a browser still reads as that scheme. */
const SCRIPT_URLS = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  '  javascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'DATA:text/html;base64,PHNjcmlwdD4=',
  'vbscript:msgbox(1)',
  'blob:https://example.com/5b1c'
]

/** Addresses of pages people really save that are not http(s). */
const BROWSER_URLS = ['chrome://extensions/', 'edge://settings/', 'about:blank', 'file:///C:/notes.txt', 'chrome-extension://abcdefgh/popup.html']

const tabsOf = (groups: Group[]) => groups.flatMap((g) => g.windows.flatMap((w) => w.tabs))
const jsonOf = (value: unknown) => JSON.stringify(value)

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

describe('skippedSuffix', () => {
  it('is empty for nothing skipped and names the count otherwise', () => {
    expect(skippedSuffix(0)).toBe('')
    expect(skippedSuffix(1)).toBe(', 1 skipped')
    expect(skippedSuffix(12)).toBe(', 12 skipped')
  })
})

describe('importGroups', () => {
  it('round-trips: export then import returns equivalent groups with nothing skipped', () => {
    const groups = [makeGroup('Research', ['https://x.com', 'https://y.com'])]
    const { groups: imported, skipped } = importGroups(exportGroups(groups))
    expect(skipped).toBe(0)
    expect(imported).toHaveLength(1)
    expect(imported[0].name).toBe('Research')
    expect(imported[0].windows[0].tabs.map((t) => t.url)).toEqual(['https://x.com', 'https://y.com'])
  })

  it('throws on invalid JSON', () => {
    expect(() => importGroups('not json {')).toThrow()
  })

  it.each([['an object', '{"available":[]}'], ['a string', '"groups"'], ['null', 'null'], ['a number', '4']])(
    'throws when the top level is %s instead of an array',
    (_what, json) => {
      expect(() => importGroups(json)).toThrow('Expected an array')
    }
  )

  it.each([
    ['null', null],
    ['a number', 7],
    ['a string', 'group'],
    ['an array', []],
    ['an object without windows', { id: '123', name: 'x' }],
    ['windows that is an object', { id: '1', name: 'x', windows: {} }],
    ['windows that is a string', { id: '1', name: 'x', windows: 'none' }]
  ])('leaves out and counts a group entry that is %s', (_what, entry) => {
    const good = { id: 'ok', name: 'Good', windows: [] }
    const result = importGroups(jsonOf([entry, good]))
    expect(result.groups.map((g) => g.name)).toEqual(['Good'])
    expect(result.skipped).toBe(1)
  })

  it.each([
    ['null', null],
    ['a number', 3],
    ['an array', []],
    ['an object without tabs', { id: 1 }],
    ['tabs that is an object', { tabs: {} }]
  ])('leaves out and counts a window entry that is %s', (_what, entry) => {
    const result = importGroups(jsonOf([{ name: 'G', windows: [entry, { tabs: [{ title: 'A', url: 'https://a.com' }] }] }]))
    expect(result.groups[0].windows).toHaveLength(1)
    expect(result.groups[0].info).toBe('1 Window ◆ 1 Tab')
    expect(result.skipped).toBe(1)
  })

  it.each([
    ['null', null],
    ['a string', 'https://a.com'],
    ['an array', ['https://a.com']],
    ['an object without url', { title: 'No url' }],
    ['a numeric url', { title: 'n', url: 42 }],
    ['an object url', { title: 'o', url: { href: 'https://a.com' } }],
    ['a relative url', { title: 'r', url: 'example.com/page' }],
    ['free text as url', { title: 't', url: 'just some words' }]
  ])('leaves out and counts a tab entry that is %s', (_what, entry) => {
    const result = importGroups(jsonOf([{ name: 'G', windows: [{ tabs: [entry, { title: 'A', url: 'https://a.com' }] }] }]))
    expect(tabsOf(result.groups).map((t) => t.url)).toEqual(['https://a.com'])
    expect(result.skipped).toBe(1)
  })

  it.each(SCRIPT_URLS)('leaves out a tab whose url is the script URL %j', (url) => {
    const result = importGroups(jsonOf([{ name: 'G', windows: [{ tabs: [{ title: 'bad', url }, { title: 'ok', url: 'https://ok.com' }] }] }]))
    expect(tabsOf(result.groups).map((t) => t.title)).toEqual(['ok'])
    expect(result.skipped).toBe(1)
  })

  it.each(BROWSER_URLS)('keeps a tab whose url is the browser address %j', (url) => {
    const result = importGroups(jsonOf([{ name: 'G', windows: [{ tabs: [{ title: 'kept', url }] }] }]))
    expect(tabsOf(result.groups).map((t) => t.url)).toEqual([url])
    expect(result.skipped).toBe(0)
  })

  it('keeps a tab with an empty url (a saved blank tab) and an emptied window or group', () => {
    const result = importGroups(jsonOf([{ name: 'G', windows: [{ tabs: [{ title: 'blank', url: '' }] }, { tabs: [{ url: 'javascript:void(0)' }] }] }]))
    expect(result.groups[0].windows.map((w) => w.tabs.length)).toEqual([1, 0])
    expect(result.skipped).toBe(1)
  })

  it('does not count the entries nested in a left-out parent', () => {
    const result = importGroups(jsonOf([{ name: 'gone', windows: 'x', extra: [{ tabs: [{ url: 'javascript:1' }] }] }, { name: 'G', windows: [{ tabs: 'x' }] }]))
    expect(result.skipped).toBe(2) // one group, one window
  })

  it('gives every imported tab and window id 0, whatever the file says', () => {
    const result = importGroups(
      jsonOf([{ name: 'G', windows: [{ id: 987, focused: true, tabs: [{ id: 4521, title: 'A', url: 'https://a.com' }, { id: 'x', title: 'B', url: 'https://b.com' }] }] }])
    )
    const [win] = result.groups[0].windows
    expect(win.id).toBe(0)
    expect(win.focused).toBe(false)
    expect(win.tabs.map((t) => t.id)).toEqual([0, 0])
  })

  it('copies only known fields: unknown keys do not pass through at any level', () => {
    const result = importGroups(
      jsonOf([
        {
          id: 'g1',
          name: 'G',
          windows: [{ tabs: [{ title: 'A', url: 'https://a.com', onclick: 'x', __proto__x: 1 }], secret: true }],
          remoteUpdatedAt: '2026-01-01T00:00:00Z',
          positionDirty: true,
          rev: 99,
          isAdmin: true
        }
      ])
    )
    const [group] = result.groups
    expect(Object.keys(group).sort()).toEqual(['color', 'id', 'info', 'name', 'pendingSync', 'permanent', 'updatedAt', 'windows'])
    expect(Object.keys(group.windows[0]).sort()).toEqual(['focused', 'id', 'incognito', 'tabs'])
    expect(Object.keys(group.windows[0].tabs[0]).sort()).toEqual(['id', 'title', 'url'])
  })

  it('keeps every well-typed optional field', () => {
    const tab = {
      title: 'A',
      url: 'https://a.com',
      customTitle: 'Mine',
      favIconUrl: 'https://a.com/favicon.ico',
      ogImage: 'data:image/png;base64,AAAA',
      pinned: true,
      note: 'tab note',
      savedAt: 1700000000000,
      chromeGroup: { id: 3, name: 'Docs', color: 'blue' },
      reminder: { fireAt: 1800000000000, note: 'later' }
    }
    const group = {
      id: 'g1',
      name: 'G',
      color: 'rgba(59, 130, 246, 1)',
      updatedAt: 1700000000001,
      starred: true,
      archived: true,
      note: 'group note',
      windows: [{ incognito: true, starred: true, name: 'W', note: 'window note', tabs: [tab] }]
    }
    const [g] = importGroups(jsonOf([group])).groups
    expect(g).toMatchObject({ id: 'g1', name: 'G', color: 'rgba(59, 130, 246, 1)', updatedAt: 1700000000001, starred: true, archived: true, note: 'group note', permanent: false, pendingSync: true })
    expect(g.windows[0]).toMatchObject({ incognito: true, starred: true, name: 'W', note: 'window note' })
    expect(g.windows[0].tabs[0]).toEqual({ ...tab, id: 0 })
  })

  it('drops or replaces every wrongly-typed field', () => {
    const tab = {
      title: 12,
      url: 'https://a.com',
      customTitle: ['x'],
      favIconUrl: 'javascript:alert(1)',
      ogImage: 5,
      pinned: 'yes',
      note: { text: 'x' },
      savedAt: 'yesterday',
      chromeGroup: { id: '3', name: 'Docs', color: 'blue' },
      reminder: { fireAt: 'soon' }
    }
    const group = {
      id: 77,
      name: { toString: 'x' },
      color: 'url(https://example.com/track)',
      updatedAt: 'now',
      starred: 'true',
      archived: 1,
      note: 9,
      info: '999 Windows',
      pendingSync: false,
      windows: [{ incognito: 'true', starred: 1, name: 4, note: [], tabs: [tab] }]
    }
    const before = Date.now()
    const [g] = importGroups(jsonOf([group])).groups
    expect(typeof g.id).toBe('string')
    expect(g.id).toHaveLength(10)
    expect(g.name).toBe(IMPORTED_GROUP_FALLBACK_NAME)
    expect(g.color).toBe(DEFAULT_GROUP_COLOR)
    expect(g.updatedAt).toBeGreaterThanOrEqual(before)
    expect(g.info).toBe('1 Window ◆ 1 Tab')
    expect(g.pendingSync).toBe(true)
    expect(g).not.toHaveProperty('starred')
    expect(g).not.toHaveProperty('archived')
    expect(g).not.toHaveProperty('note')
    expect(g.windows[0]).toEqual({ id: 0, incognito: false, focused: false, tabs: [{ id: 0, title: 'https://a.com', url: 'https://a.com' }] })
  })

  it.each([
    ['a color name the tab-group API does not know', { id: 1, name: 'n', color: 'magenta' }],
    ['a missing name', { id: 1, color: 'blue' }],
    ['a non-finite id', { id: null, name: 'n', color: 'blue' }],
    ['an array', [1, 'n', 'blue']]
  ])('drops a chromeGroup with %s', (_what, chromeGroup) => {
    const [tab] = tabsOf(importGroups(jsonOf([{ name: 'G', windows: [{ tabs: [{ url: 'https://a.com', chromeGroup }] }] }])).groups)
    expect(tab).not.toHaveProperty('chromeGroup')
  })

  it('keeps a reminder without a note and drops a wrongly-typed reminder note', () => {
    const tabs = tabsOf(
      importGroups(jsonOf([{ name: 'G', windows: [{ tabs: [{ url: 'https://a.com', reminder: { fireAt: 5 } }, { url: 'https://b.com', reminder: { fireAt: 6, note: 1 } }] }] }])).groups
    )
    expect(tabs.map((t) => t.reminder)).toEqual([{ fireAt: 5 }, { fireAt: 6 }])
  })

  it.each(['#abc', '#A1B2C3', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'rgba(1, 2, 3, 1)'])('keeps the colour %s', (color) => {
    expect(importGroups(jsonOf([{ name: 'G', color, windows: [] }])).groups[0].color).toBe(color)
  })

  it.each(['red', 'expression(alert(1))', 'rgba(1,2,3,1); background: url(x)', '#12', ''])('replaces the colour %j with the default', (color) => {
    expect(importGroups(jsonOf([{ name: 'G', color, windows: [] }])).groups[0].color).toBe(DEFAULT_GROUP_COLOR)
  })

  it('never returns a "Now Open" group: a permanent group in the file is not imported', () => {
    const file = [
      { id: 'now', name: 'Now Open', permanent: true, windows: [{ tabs: [{ title: 'Live', url: 'https://live.com' }] }] },
      { id: 'a', name: 'Saved', permanent: false, windows: [] },
      { id: 'b', name: 'Second permanent', permanent: true, windows: [] }
    ]
    const result = importGroups(jsonOf(file))
    expect(result.groups.map((g) => g.name)).toEqual(['Saved'])
    expect(result.groups.every((g) => g.permanent === false)).toBe(true)
    expect(result.skipped).toBe(1) // only the second one: the first is the exporter's open tabs, left out by design
  })

  it.each([['"true"', 'true'], ['1', 1], ['an object', {}]])('treats permanent: %s as a saved group, never as "Now Open"', (_what, permanent) => {
    const result = importGroups(jsonOf([{ name: 'G', permanent, windows: [] }]))
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].permanent).toBe(false)
  })
})

describe('importGroupsState', () => {
  const state = (available: unknown, extra: Record<string, unknown> = {}) => jsonOf({ active: { id: 'a', index: 1 }, available, ...extra })

  it('throws on invalid JSON', () => {
    expect(() => importGroupsState('{ nope')).toThrow()
  })

  it.each([['an array', '[]'], ['null', 'null'], ['a string', '"x"'], ['an object without available', '{"foo":1}'], ['available that is an object', '{"available":{}}']])(
    'throws "Invalid format" when the file is %s',
    (_what, json) => {
      expect(() => importGroupsState(json)).toThrow('Invalid format')
    }
  )

  it('returns the validated state with only active and available', () => {
    const { state: result, skipped } = importGroupsState(
      state([{ id: 'a', name: 'A', windows: [{ tabs: [{ title: 'T', url: 'https://t.com' }] }] }], { urlRules: [{ pattern: '*' }], rev: 41, anything: 'else' })
    )
    expect(skipped).toBe(0)
    expect(Object.keys(result).sort()).toEqual(['active', 'available'])
    expect(result.active).toEqual({ id: 'a', index: 1 })
    expect(result.available.map((g) => g.name)).toEqual(['A'])
  })

  it.each([
    ['missing', undefined],
    ['a string', 'a'],
    ['wrongly typed inside', { id: 5, index: '2' }]
  ])('falls back to an empty active when it is %s', (_what, active) => {
    const { state: result } = importGroupsState(jsonOf({ active, available: [] }))
    expect(result.active).toEqual({ id: '', index: 0 })
  })

  it('keeps one "Now Open" group, first, and counts any further permanent group as skipped', () => {
    const { state: result, skipped } = importGroupsState(
      state([
        { id: 's', name: 'Saved', windows: [] },
        { id: 'n1', name: 'Now Open', permanent: true, windows: [] },
        { id: 'n2', name: 'Another', permanent: true, windows: [] }
      ])
    )
    expect(result.available.map((g) => [g.name, g.permanent])).toEqual([['Now Open', true], ['Saved', false]])
    expect(skipped).toBe(1)
  })

  it('counts left-out script URLs and malformed entries across the whole file', () => {
    const { state: result, skipped } = importGroupsState(
      state([
        { name: 'A', windows: [{ tabs: [{ url: 'https://a.com' }, { url: 'JAVASCRIPT:alert(1)' }, { url: 'data:text/html,x' }] }, 'window'] },
        'group'
      ])
    )
    expect(tabsOf(result.available).map((t) => t.url)).toEqual(['https://a.com'])
    expect(skipped).toBe(4)
  })

  it('accepts a file with no groups at all (an empty backup)', () => {
    expect(importGroupsState(state([])).state.available).toEqual([])
  })

  it('throws when the file had entries but none is a usable group', () => {
    expect(() => importGroupsState(state([{ name: 'x' }, 3]))).toThrow('No groups found')
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
    const { groups, skipped } = parseBookmarksHtml(html)
    expect(skipped).toBe(0)
    const work = groups.find((g) => g.name === 'Work')
    expect(work).toBeDefined()
    const tabs = work!.windows.flatMap((w) => w.tabs)
    expect(tabs.map((t) => [t.title, t.url, t.id])).toEqual([['GitHub', 'https://github.com', 0], ['Linear', 'https://linear.app', 0]])
    expect(work!.windows[0].id).toBe(0)
    expect(work!.info).toBe('1 Window ◆ 2 Tabs')
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
    const urls = tabsOf(parseBookmarksHtml(nestedHtml).groups).map((t) => t.url)
    expect(urls).toContain('https://nested.com')
    expect(urls).toContain('https://outer.com')
  })

  it('leaves out bookmarklets and other script URLs, relative links and links without an address, and counts them', () => {
    const mixed = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Mixed</H3>
  <DL><p>
    <DT><A HREF="https://keep.example.com">Keep</A>
    <DT><A HREF="javascript:(function(){alert(1)})()">Bookmarklet</A>
    <DT><A HREF="JaVaScRiPt:alert(2)">Mixed case</A>
    <DT><A HREF="  javascript:alert(3)">Leading space</A>
    <DT><A HREF="java&#9;script:alert(4)">Embedded tab</A>
    <DT><A HREF="data:text/html,<b>x</b>">Data</A>
    <DT><A HREF="vbscript:msgbox(1)">VB</A>
    <DT><A HREF="/relative/path">Relative</A>
    <DT><A>No address</A>
    <DT><A HREF="chrome://extensions/">Extensions</A>
    <DT><A HREF="file:///C:/notes.txt">Notes</A>
  </DL><p>
</DL><p>`
    const { groups, skipped } = parseBookmarksHtml(mixed)
    expect(tabsOf(groups).map((t) => t.url)).toEqual(['https://keep.example.com', 'chrome://extensions/', 'file:///C:/notes.txt'])
    expect(skipped).toBe(8)
  })

  it('makes no group for a folder left with no links, and still reports what was left out', () => {
    const onlyScripts = `<DL><p>
  <DT><H3>Bookmarklets</H3>
  <DL><p>
    <DT><A HREF="javascript:void(0)">One</A>
    <DT><A HREF="javascript:void(1)">Two</A>
  </DL><p>
  <DT><H3>Empty folder</H3>
  <DL><p></DL><p>
</DL><p>`
    expect(parseBookmarksHtml(onlyScripts)).toEqual({ groups: [], skipped: 2 })
  })

  it('uses the address as the title of a link without text', () => {
    const { groups } = parseBookmarksHtml(`<DL><p><DT><H3>F</H3><DL><p><DT><A HREF="https://untitled.example.com"></A></DL><p></DL><p>`)
    expect(tabsOf(groups)[0].title).toBe('https://untitled.example.com')
  })

  it('returns no groups when there are no folders or no list at all', () => {
    const bare = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><A HREF="https://example.com">Example</A>
</DL><p>`
    expect(parseBookmarksHtml(bare)).toEqual({ groups: [], skipped: 0 })
    expect(parseBookmarksHtml('<p>not a bookmarks file</p>')).toEqual({ groups: [], skipped: 0 })
  })
})

describe('parseOneTabs', () => {
  it('parses a OneTab export into groups separated by blank lines', () => {
    const text = `https://github.com | GitHub
https://linear.app | Linear

https://notion.so | Notion`

    const { groups, skipped } = parseOneTabs(text)
    expect(skipped).toBe(0)
    expect(groups.map((g) => g.name)).toEqual(['Imported 1', 'Imported 2'])
    const firstTabs = groups[0].windows.flatMap((w) => w.tabs)
    expect(firstTabs.map((t) => [t.title, t.url, t.id])).toEqual([['GitHub', 'https://github.com', 0], ['Linear', 'https://linear.app', 0]])
    expect(groups[1].windows[0].tabs.map((t) => t.url)).toEqual(['https://notion.so'])
    expect(groups[1].windows[0].id).toBe(0)
  })

  it('parses a single group with no blank lines as one group', () => {
    const text = `https://github.com | GitHub
https://linear.app | Linear
https://notion.so | Notion`

    const { groups } = parseOneTabs(text)
    expect(groups).toHaveLength(1)
    expect(tabsOf(groups)).toHaveLength(3)
  })

  it('uses the address as the title of a line without one', () => {
    expect(tabsOf(parseOneTabs('https://plain.example.com').groups)[0]).toMatchObject({ title: 'https://plain.example.com', url: 'https://plain.example.com' })
  })

  it('leaves out script URLs and lines that are not an address, and counts them', () => {
    const text = `https://keep.example.com | Keep
javascript:alert(1) | Bookmarklet
JAVASCRIPT:alert(2) | Upper
data:text/html,<script>alert(3)</script> | Data
some words that are not a link
example.com/no-scheme | No scheme
chrome://settings/ | Settings`
    const { groups, skipped } = parseOneTabs(text)
    expect(tabsOf(groups).map((t) => t.url)).toEqual(['https://keep.example.com', 'chrome://settings/'])
    expect(skipped).toBe(5)
  })

  it('makes no group for a block left with no lines and numbers the remaining groups without a hole', () => {
    const text = `https://a.example.com | A

javascript:alert(1) | only this

https://b.example.com | B`
    const { groups, skipped } = parseOneTabs(text)
    expect(groups.map((g) => g.name)).toEqual(['Imported 1', 'Imported 2'])
    expect(skipped).toBe(1)
  })

  it('returns no groups for an empty file', () => {
    expect(parseOneTabs('')).toEqual({ groups: [], skipped: 0 })
    expect(parseOneTabs('\n\n  \n')).toEqual({ groups: [], skipped: 0 })
  })
})
