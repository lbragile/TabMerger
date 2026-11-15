import { describe, it, expect } from 'vitest'
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed'
import type { GroupsState } from '@/lib/types'
import { createGroup, createTab, createWindow } from '@/lib/utils'
import { addClosedEntriesToState, closedTabCount, savedTabFromClosed, siteGroupName } from '@/lib/recentlyClosedSave'

const NOW = 1_800_000_000_000

const tab = (url: string, title = url) => ({ url, title })
const tabEntry = (url: string): RecentlyClosedEntry => ({ id: `t-${url}`, closedAt: NOW - 1000, kind: 'tab', tabs: [tab(url)] })
const windowEntry = (...urls: string[]): RecentlyClosedEntry => ({ id: `w-${urls.join()}`, closedAt: NOW - 2000, kind: 'window', tabs: urls.map((u) => tab(u)) })

function state(): GroupsState {
  const nowOpen = createGroup('now', 'Now Open')
  nowOpen.permanent = true
  const work = createGroup('work', 'Work')
  work.windows = [createWindow([createTab('Old', 'https://old.example')])]
  work.pendingSync = false
  const empty = createGroup('empty', 'Empty')
  const archived = createGroup('arch', 'Archived')
  archived.archived = true
  return { available: [nowOpen, work, empty, archived], active: { id: 'now', index: 0 } }
}

describe('savedTabFromClosed', () => {
  it('makes a saved tab: id 0, no pin, savedAt stamped, favicon kept', () => {
    expect(savedTabFromClosed({ url: 'https://a.example', title: 'A', favIconUrl: 'https://a.example/f.ico', pinned: true }, NOW)).toEqual({
      id: 0,
      title: 'A',
      url: 'https://a.example',
      favIconUrl: 'https://a.example/f.ico',
      savedAt: NOW,
    })
    expect(savedTabFromClosed({ url: 'https://a.example', title: 'A' }, NOW)).not.toHaveProperty('favIconUrl')
  })
})

describe('closedTabCount / siteGroupName', () => {
  it('counts every tab, the ones in windows too', () => {
    expect(closedTabCount([tabEntry('https://a.example'), windowEntry('https://b.example', 'https://c.example')])).toBe(3)
  })

  it('names a new group after the first site, without www.', () => {
    expect(siteGroupName([tabEntry('https://www.github.com/x')])).toBe('github.com')
    expect(siteGroupName([windowEntry('https://figma.com/a', 'https://x.example')])).toBe('figma.com')
  })

  it('is empty when there is no readable address', () => {
    expect(siteGroupName([])).toBe('')
    expect(siteGroupName([{ tabs: [tab('not a url')] }])).toBe('')
  })
})

describe('addClosedEntriesToState', () => {
  it("a tab goes into the group's last window, marked pending and recounted", () => {
    const out = addClosedEntriesToState(state(), [tabEntry('https://a.example')], { groupId: 'work' }, NOW)!
    const work = out.state.available[1]
    expect(out.groupId).toBe('work')
    expect(work.windows).toHaveLength(1)
    expect(work.windows[0].tabs.map((t) => t.url)).toEqual(['https://old.example', 'https://a.example'])
    expect(work.pendingSync).toBe(true)
    expect(work.updatedAt).toBe(NOW)
    expect(work.info).toContain('2')
  })

  it('a tab into a group with no window gets a new window', () => {
    const out = addClosedEntriesToState(state(), [tabEntry('https://a.example')], { groupId: 'empty' }, NOW)!
    expect(out.state.available[2].windows).toHaveLength(1)
    expect(out.state.available[2].windows[0].tabs[0]).toMatchObject({ id: 0, url: 'https://a.example' })
  })

  it('a window entry becomes one window in the group', () => {
    const out = addClosedEntriesToState(state(), [windowEntry('https://b.example', 'https://c.example')], { groupId: 'work' }, NOW)!
    const work = out.state.available[1]
    expect(work.windows).toHaveLength(2)
    expect(work.windows[1].tabs.map((t) => t.url)).toEqual(['https://b.example', 'https://c.example'])
  })

  it('a day with tabs and windows: the single tabs go together in their own window, each window stays a window', () => {
    const out = addClosedEntriesToState(
      state(),
      [tabEntry('https://a.example'), windowEntry('https://b.example', 'https://c.example'), tabEntry('https://d.example')],
      { groupId: 'work' },
      NOW
    )!
    const urls = out.state.available[1].windows.map((w) => w.tabs.map((t) => t.url))
    expect(urls).toEqual([['https://old.example'], ['https://a.example', 'https://d.example'], ['https://b.example', 'https://c.example']])
  })

  it('a new group named after the site is added at the end; nothing else changes', () => {
    const before = state()
    const out = addClosedEntriesToState(before, [tabEntry('https://github.com/x')], { newGroupName: 'github.com' }, NOW)!
    expect(out.state.available).toHaveLength(before.available.length + 1)
    const created = out.state.available[out.state.available.length - 1]
    expect(created.name).toBe('github.com')
    expect(created.id).toBe(out.groupId)
    expect(created.pendingSync).toBe(true)
    expect(created.windows[0].tabs[0].url).toBe('https://github.com/x')
    expect(out.state.available.slice(0, 4)).toEqual(before.available)
  })

  it('a new group without a name gets the default name', () => {
    const out = addClosedEntriesToState(state(), [tabEntry('https://a.example')], { newGroupName: '' }, NOW)!
    expect(out.state.available[4].name).toBeTruthy()
  })

  it.each([
    ['Now Open', 'now'],
    ['an archived group', 'arch'],
    ['a group that is gone', 'missing'],
  ])('does nothing for %s', (_label, groupId) => {
    expect(addClosedEntriesToState(state(), [tabEntry('https://a.example')], { groupId }, NOW)).toBeNull()
  })

  it('does nothing without tabs', () => {
    expect(addClosedEntriesToState(state(), [], { groupId: 'work' }, NOW)).toBeNull()
  })

  it('never edits the state it was given', () => {
    const before = state()
    const snapshot = JSON.parse(JSON.stringify(before))
    addClosedEntriesToState(before, [tabEntry('https://a.example')], { groupId: 'work' }, NOW)
    expect(before).toEqual(snapshot)
  })
})
