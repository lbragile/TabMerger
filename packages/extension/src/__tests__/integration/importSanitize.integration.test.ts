import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useGroups, useImportGroups, useSetGroupsState } from '@/hooks/useGroups'
import { getGroupsState, saveGroupsState } from '@/lib/localDb'
import { importGroups, importGroupsState, parseBookmarksHtml, parseOneTabs } from '@/lib/importExport'
import { prepareImportedState } from '@/lib/syncDirty'
import { createGroup, createNowOpenGroup, createWindow, createTab } from '@/lib/utils'
import type { GroupsState } from '@/lib/types'
import { clearDb } from './dbTestUtils'

// Real IndexedDB, no vi.mock('@/lib/localDb'): what an import leaves on disk is the thing under test.

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

async function seed(): Promise<GroupsState> {
  const nowOpen = createNowOpenGroup()
  const existing = createGroup('existing', 'Existing')
  existing.windows = [createWindow([createTab('Old', 'https://old.example.com')])]
  const state: GroupsState = { active: { id: nowOpen.id, index: 0 }, available: [nowOpen, existing] }
  await saveGroupsState(state)
  return state
}

/** A backup holding a valid group, script URLs in several spellings, malformed entries and a second "Now Open". */
const HOSTILE_GROUPS = [
  { id: 'now', name: 'Now Open', permanent: true, windows: [{ tabs: [{ title: 'Live', url: 'https://live.example.com' }] }] },
  {
    id: 'existing', // same id as a stored group: must become a new group, not overwrite it
    name: 'Mixed',
    color: 'rgba(59, 130, 246, 1)',
    remoteUpdatedAt: '2026-01-01T00:00:00.000Z',
    positionDirty: true,
    windows: [
      {
        id: 4242,
        focused: true,
        tabs: [
          { id: 99, title: 'Keep', url: 'https://keep.example.com', evil: true },
          { id: 98, title: 'Script', url: 'JaVaScRiPt:alert(1)' },
          { id: 97, title: 'Tabbed', url: 'java\tscript:alert(1)' },
          { id: 96, title: 'Data', url: 'data:text/html,<script>alert(1)</script>' },
          { id: 95, title: 'Extensions', url: 'chrome://extensions/' },
          'not a tab'
        ]
      },
      'not a window'
    ]
  },
  { id: 'second-permanent', name: 'Also permanent', permanent: true, windows: [] },
  'not a group'
]

const stored = async () => (await getGroupsState()).available
const urlsOf = (g: { windows: { tabs: { url: string }[] }[] }) => g.windows.flatMap((w) => w.tabs.map((t) => t.url))

describe('import — real IndexedDB round trip', () => {
  beforeEach(async () => {
    await clearDb()
  })

  it('appending import stores only validated groups, under new ids, and keeps one "Now Open"', async () => {
    const seeded = await seed()
    const { groups, skipped } = importGroups(JSON.stringify(HOSTILE_GROUPS))
    expect(skipped).toBe(7) // 3 script tabs, 1 non-tab, 1 non-window, the second permanent group, 1 non-group

    const { result: groupsQuery } = renderHook(() => useGroups(), { wrapper })
    await waitFor(() => expect(groupsQuery.current.data).toBeDefined())
    const { result: importer } = renderHook(() => useImportGroups(), { wrapper })
    await importer.current.mutateAsync(groups)

    const available = await stored()
    expect(available.map((g) => g.name)).toEqual(['Now Open', 'Existing', 'Mixed'])
    expect(available.filter((g) => g.permanent)).toHaveLength(1)
    expect(available[0].id).toBe(seeded.available[0].id)

    // the stored group with the colliding id is untouched; the imported one has a fresh id
    expect(urlsOf(available[1])).toEqual(['https://old.example.com'])
    const mixed = available[2]
    expect(mixed.id).not.toBe('existing')
    expect(mixed).toMatchObject({ permanent: false, pendingSync: true, color: 'rgba(59, 130, 246, 1)' })
    expect(mixed).not.toHaveProperty('remoteUpdatedAt')
    expect(urlsOf(mixed)).toEqual(['https://keep.example.com', 'chrome://extensions/'])
    expect(mixed.windows).toHaveLength(1)
    expect(mixed.windows[0]).toMatchObject({ id: 0, focused: false, incognito: false })
    expect(mixed.windows[0].tabs.map((t) => t.id)).toEqual([0, 0])
    expect(mixed.windows[0].tabs[0]).not.toHaveProperty('evil')
  })

  it('replacing import stores the validated state and keeps the current "Now Open" instead of the file\'s', async () => {
    const seeded = await seed()
    const { state, skipped } = importGroupsState(JSON.stringify({ active: { id: 'existing', index: 1 }, available: HOSTILE_GROUPS, rev: 999, extra: 'x' }))
    expect(skipped).toBe(7)

    const { result: setState } = renderHook(() => useSetGroupsState(), { wrapper })
    await setState.current(prepareImportedState(state, seeded))

    const after = await getGroupsState()
    expect(after.available.map((g) => g.name)).toEqual(['Now Open', 'Mixed'])
    expect(after.available[0].id).toBe(seeded.available[0].id) // the live one, not the file's
    expect(after.available.filter((g) => g.permanent)).toHaveLength(1)
    expect(urlsOf(after.available[1])).toEqual(['https://keep.example.com', 'chrome://extensions/'])
    expect(after.available[1].id).not.toBe('existing')
    expect(after.active.id).toBe(after.available[1].id) // active followed the group to its new id
    expect(after).not.toHaveProperty('extra')
  })

  it('bookmark and OneTab imports store saved tabs (id 0) without the script URLs of the file', async () => {
    await seed()
    const bookmarks = parseBookmarksHtml(`<DL><p>
  <DT><H3>Reading</H3>
  <DL><p>
    <DT><A HREF="https://read.example.com">Read</A>
    <DT><A HREF="javascript:(function(){})()">Bookmarklet</A>
  </DL><p>
</DL><p>`)
    const oneTab = parseOneTabs('https://one.example.com | One\njavascript:alert(1) | Script')
    expect([bookmarks.skipped, oneTab.skipped]).toEqual([1, 1])

    const { result: groupsQuery } = renderHook(() => useGroups(), { wrapper })
    await waitFor(() => expect(groupsQuery.current.data).toBeDefined())
    const { result: importer } = renderHook(() => useImportGroups(), { wrapper })
    await importer.current.mutateAsync([...bookmarks.groups, ...oneTab.groups])

    const available = await stored()
    expect(available.map((g) => g.name)).toEqual(['Now Open', 'Existing', 'Reading', 'Imported 1'])
    expect(urlsOf(available[2])).toEqual(['https://read.example.com'])
    expect(urlsOf(available[3])).toEqual(['https://one.example.com'])
    expect(available.slice(2).flatMap((g) => g.windows.flatMap((w) => w.tabs.map((t) => t.id)))).toEqual([0, 0])
  })
})
