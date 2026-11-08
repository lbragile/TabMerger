import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { Group } from '@/lib/types'
import { getDb, getGroupsState, saveGroupsState, setSetting, updateGroupsState } from '@/lib/localDb'
import { useKeepAutoSave, useUpdateGroupName } from '@/hooks/useGroups'
import { onAutoSavePromoted } from '@/lib/autoSaveGroups'
import { runAutoSave } from '@/lib/autoSaveRun'
import { APP_SETTINGS_KEY } from '@/lib/syncSettingKeys'
import { clearDb } from './dbTestUtils'

// Real IndexedDB (fake-indexeddb): only chrome.* and the network are stubbed.
const net = vi.hoisted(() => ({ session: null as null | { user: { id: string } }, tier: 'pro' as string | null }))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: net.session } }) } },
}))
vi.mock('@/lib/entitlementTier', () => ({ fetchTier: async () => net.tier }))

const NOW = Date.UTC(2030, 10, 5, 14, 30)
type LiveTab = { windowId: number; index: number; url: string; title?: string }
let liveTabs: LiveTab[]

const stubChrome = () => {
  const c = globalThis.chrome as unknown as Record<string, Record<string, unknown>>
  c.tabs.query = vi.fn(async () => liveTabs)
  c.windows.getAll = vi.fn(async () => [{ id: 1, type: 'normal', incognito: false }, { id: 2, type: 'normal', incognito: true }])
  c.runtime.id = 'ext'
  c.runtime.getURL = (p: string) => `chrome-extension://ext/${p}`
  c.runtime.sendMessage = vi.fn()
}

const tabsOf = (g: Group) => g.windows.flatMap((w) => w.tabs.map((t) => t.url))
const saved = async () => (await getGroupsState()).available.filter((g) => !g.permanent)
const storedRev = async () => ((await (await getDb()).get('groupsState', 'state')) as { rev?: number } | undefined)?.rev ?? 0
const group = (id: string, urls: string[], extra: Partial<Group> = {}): Group => ({
  id, name: id, color: 'rgba(1, 2, 3, 1)', updatedAt: 1,
  windows: [{ id: 1, tabs: urls.map((url) => ({ id: 0, title: url, url, savedAt: 1 })), incognito: false, focused: false }],
  ...extra,
})

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(async () => {
  await clearDb()
  net.session = { user: { id: 'u1' } }
  net.tier = 'pro'
  liveTabs = [
    { windowId: 1, index: 0, url: 'https://a.test/', title: 'A' },
    { windowId: 1, index: 1, url: 'https://b.test/', title: 'B' },
    { windowId: 2, index: 0, url: 'https://private.test/' },
  ]
  stubChrome()
})

describe('auto-save — real IndexedDB', () => {
  it('a run alongside a concurrent popup write: both land, the auto-save is pending, private windows skipped', async () => {
    await getGroupsState()
    let releaseTabs!: () => void
    const tabsGate = new Promise<void>((r) => (releaseTabs = r))
    ;(globalThis.chrome.tabs.query as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      await tabsGate
      return liveTabs
    })
    const run = runAutoSave({ trigger: 'manual', now: NOW })
    // the popup saves a group while the run is between its browser query and its write
    const popupWrite = updateGroupsState((s) => ({ ...s, available: [...s.available, group('popup', ['https://p.test/'])] }))
    releaseTabs()
    // and another write races the run's own read-modify-write
    const popupRename = updateGroupsState((s) => ({ ...s, available: s.available.map((g) => (g.id === 'popup' ? { ...g, name: 'Renamed' } : g)) }))
    const [outcome] = await Promise.all([run, popupWrite, popupRename])

    expect(outcome).toMatchObject({ status: 'saved', saved: 2, total: 2 })
    const groups = await saved()
    expect(groups.find((g) => g.id === 'popup')?.name).toBe('Renamed')
    const auto = groups.find((g) => g.autoSave)!
    expect(auto).toMatchObject({ pendingSync: true, autoSave: { at: NOW, rolling: false } })
    expect(tabsOf(auto)).toEqual(['https://a.test/', 'https://b.test/'])
    expect((await getGroupsState()).available[0].permanent).toBe(true)
  })

  it('Free: replaces the oldest rolling auto-save in ONE write, carrying its still-open tabs forward', async () => {
    net.session = null // signed out = Free, confirmed
    await setSetting(APP_SETTINGS_KEY, { autoSaveTabsEnabled: true })
    const base = await getGroupsState()
    await saveGroupsState({
      ...base,
      available: [
        base.available[0],
        group('r1', ['https://a.test/', 'https://closed.test/'], { autoSave: { at: 100, rolling: true } }),
        group('kept', ['https://k.test/']),
        group('r2', ['https://b.test/'], { autoSave: { at: 200, rolling: true } }),
      ],
    })
    liveTabs = [...liveTabs, { windowId: 1, index: 2, url: 'https://c.test/' }]
    const revBefore = await storedRev()

    const outcome = await runAutoSave({ trigger: 'manual', now: NOW })

    expect(outcome).toMatchObject({ status: 'saved', replaced: 1, saved: 2, total: 2 })
    expect(await storedRev()).toBe(revBefore + 1) // one atomic write: add + remove together
    const groups = await saved()
    expect(groups.map((g) => g.id).slice(0, 2)).toEqual(['kept', 'r2'])
    const fresh = groups[2]
    expect(fresh.autoSave).toEqual({ at: NOW, rolling: true })
    // a.test was only in the replaced r1: it carries forward; b.test is still saved in r2
    expect(tabsOf(fresh)).toEqual(['https://a.test/', 'https://c.test/'])
    expect(groups.some((g) => g.id === 'r1')).toBe(false)
  })

  it('nothing new: no write at all', async () => {
    const base = await getGroupsState()
    await saveGroupsState({ ...base, available: [base.available[0], group('k', ['https://a.test/', 'https://b.test/'])] })
    const revBefore = await storedRev()
    expect(await runAutoSave({ trigger: 'manual', now: NOW })).toMatchObject({ status: 'skipped', reason: 'nothing-new' })
    expect(await storedRev()).toBe(revBefore)
  })

  it('editing an auto-saved group keeps it (marker dropped in the write); Keep does the same on purpose', async () => {
    const base = await getGroupsState()
    await saveGroupsState({
      ...base,
      available: [base.available[0], group('x', ['https://x.test/'], { autoSave: { at: 1, rolling: true } }), group('y', ['https://y.test/'], { autoSave: { at: 2, rolling: true } })],
    })
    const promoted: string[] = []
    const off = onAutoSavePromoted((gs) => promoted.push(...gs.map((g) => g.id)))

    const { result: rename } = renderHook(() => useUpdateGroupName(), { wrapper })
    await rename.current.mutateAsync({ groupIndex: 1, name: 'Mine now' })
    let groups = await saved()
    expect(groups[0]).toMatchObject({ name: 'Mine now', pendingSync: true })
    expect(groups[0].autoSave).toBeUndefined()
    expect(promoted).toEqual(['x'])

    const { result: keep } = renderHook(() => useKeepAutoSave(), { wrapper })
    await keep.current.mutateAsync('y')
    groups = await saved()
    expect(groups[1].autoSave).toBeUndefined()
    expect(groups[1].pendingSync).toBe(true)
    // a Keep drops the marker itself: no "edited" notice for it
    expect(promoted).toEqual(['x'])
    off()
  })

  it('a pulled server copy of an untouched auto-save (merge write) keeps the marker', async () => {
    net.session = null
    await setSetting(APP_SETTINGS_KEY, { autoSaveTabsEnabled: true })
    await runAutoSave({ trigger: 'manual', now: NOW })
    const local = (await saved())[0]
    expect(local.autoSave).toBeTruthy()
    const promoted: string[] = []
    const off = onAutoSavePromoted((gs) => promoted.push(...gs.map((g) => g.id)))
    // the shape rowToGroup gives a pulled row: no `permanent`, explicit starred/archived, not pending
    const { permanent: _p, pendingSync: _s, ...rest } = local
    const pulled: Group = { ...rest, starred: false, archived: false, note: undefined, pendingSync: false, remoteUpdatedAt: new Date(NOW + 5000).toISOString(), updatedAt: NOW + 5000 }
    await updateGroupsState((s) => ({ ...s, available: s.available.map((g) => (g.id === local.id ? pulled : g)) }))
    expect((await saved())[0].autoSave).toEqual(local.autoSave)
    expect(promoted).toEqual([])
    off()
  })

  it('a write that only touches Now Open never promotes an auto-save', async () => {
    const base = await getGroupsState()
    await saveGroupsState({ ...base, available: [base.available[0], group('x', ['https://x.test/'], { autoSave: { at: 1, rolling: true } })] })
    await updateGroupsState((s) => ({ ...s, available: s.available.map((g) => (g.permanent ? { ...g, windows: [], updatedAt: Date.now() } : g)) }))
    expect((await saved())[0].autoSave).toEqual({ at: 1, rolling: true })
  })
})
