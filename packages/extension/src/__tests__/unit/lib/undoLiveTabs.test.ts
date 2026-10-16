import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/deferredTabClose', () => ({ keepTabsOpen: vi.fn(), closeTabsWhenPopupCloses: vi.fn() }))
vi.mock('@/lib/incognito', () => ({ resolveIncognito: vi.fn(async (was?: boolean) => !!was) }))

import { EFFECT_WAIT_MS, historyEntryEffect, liveTabRecords, runLiveTabsEffect, settledEntryEffect, tagHistoryEntry, type LiveTabRecord } from '@/lib/undoLiveTabs'
import { keepTabsOpen } from '@/lib/deferredTabClose'
import type { GroupsState } from '@/lib/types'

type Fn = ReturnType<typeof vi.fn>
let c: { tabs: Record<string, Fn>; windows: Record<string, Fn> }

/** A fake browser: `open` holds the tabs that exist now (id → url). */
function stubChrome(open: Map<number, string>, existingWindows: number[] = [7]) {
  let nextId = 500
  c = {
    tabs: {
      get: vi.fn(async (id: number) => {
        if (!open.has(id)) throw new Error(`No tab with id: ${id}`)
        return { id, url: open.get(id), windowId: 7, index: 0, pinned: false, incognito: false }
      }),
      create: vi.fn(async ({ url }: { url: string }) => {
        const id = nextId++
        open.set(id, url)
        return { id, url }
      }),
      remove: vi.fn(async (ids: number[]) => ids.forEach((id) => open.delete(id))),
      query: vi.fn().mockResolvedValue([])
    },
    windows: {
      get: vi.fn(async (id: number) => {
        if (!existingWindows.includes(id)) throw new Error('No window')
        return { id }
      }),
      create: vi.fn(async ({ url }: { url: string[] }) => ({
        id: 90,
        tabs: url.map((u) => {
          const id = nextId++
          open.set(id, u)
          return { id, url: u }
        })
      })),
      getCurrent: vi.fn().mockResolvedValue({ id: 7 })
    }
  }
  vi.stubGlobal('chrome', c)
}

const rec = (tabId: number, url: string, over: Partial<LiveTabRecord> = {}): LiveTabRecord => ({ tabId, url, windowId: 7, index: 0, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('tagHistoryEntry / historyEntryEffect', () => {
  it('attaches an effect to the entry object and ignores empty effects or a missing entry', () => {
    const entry = { active: { id: '', index: 0 }, available: [] } as GroupsState
    tagHistoryEntry(entry, { kind: 'close', tabs: [] })
    expect(historyEntryEffect(entry)).toBeUndefined()
    tagHistoryEntry(undefined, { kind: 'close', tabs: [rec(1, 'https://a')] })
    tagHistoryEntry(entry, null)
    expect(historyEntryEffect(entry)).toBeUndefined()
    tagHistoryEntry(entry, { kind: 'close', tabs: [rec(1, 'https://a')] })
    expect(historyEntryEffect(entry)).toEqual({ kind: 'close', tabs: [rec(1, 'https://a')] })
    expect(historyEntryEffect(undefined)).toBeUndefined()
  })
})

describe('liveTabRecords', () => {
  it('records the Now Open tabs with those ids: url, window, position, pin, incognito; skips script urls and saved groups', () => {
    const state = {
      active: { id: 'now', index: 0 },
      available: [
        {
          id: 'now', name: 'Now Open', color: '', updatedAt: 0, permanent: true,
          windows: [{ id: 7, incognito: true, focused: false, tabs: [{ id: 41, title: 'a', url: 'https://a' }, { id: 42, title: 'b', url: 'https://b', pinned: true }, { id: 43, title: 'x', url: 'javascript:alert(1)' }] }]
        },
        { id: 'work', name: 'Work', color: '', updatedAt: 0, windows: [{ id: 0, incognito: false, focused: false, tabs: [{ id: 42, title: 'dup', url: 'https://dup' }] }] }
      ]
    } as GroupsState
    expect(liveTabRecords(state, [42, 43])).toEqual([{ tabId: 42, url: 'https://b', windowId: 7, index: 1, pinned: true, incognito: true }])
  })
})

describe('runLiveTabsEffect — reopen (Undo of a drag out of Now Open)', () => {
  it('reopens a closed tab in its window at its position, in the background, and returns a close of the NEW id', async () => {
    stubChrome(new Map())
    const inverse = await runLiveTabsEffect({ kind: 'reopen', tabs: [rec(42, 'https://b', { index: 3, pinned: true })] })
    expect(c.tabs.create).toHaveBeenCalledWith({ windowId: 7, url: 'https://b', index: 3, active: false, pinned: true })
    expect(inverse).toEqual({ kind: 'close', tabs: [rec(500, 'https://b', { index: 3, pinned: true })] })
  })

  it('a tab that is still open (its close was deferred until the popup closes) is kept open, not reopened', async () => {
    stubChrome(new Map([[42, 'https://b']]))
    const inverse = await runLiveTabsEffect({ kind: 'reopen', tabs: [rec(42, 'https://b')] })
    expect(c.tabs.create).not.toHaveBeenCalled()
    expect(keepTabsOpen).toHaveBeenCalledWith([42])
    expect(inverse).toEqual({ kind: 'close', tabs: [rec(42, 'https://b')] })
  })

  it('when the window is gone, the tabs reopen together in ONE new unfocused window, in their old order', async () => {
    stubChrome(new Map(), [])
    const inverse = await runLiveTabsEffect({
      kind: 'reopen',
      tabs: [rec(2, 'https://second', { index: 1, incognito: true }), rec(1, 'https://first', { index: 0 })]
    })
    expect(c.windows.create).toHaveBeenCalledWith({ url: ['https://first', 'https://second'], focused: false, incognito: true })
    expect(inverse?.tabs.map((t) => [t.tabId, t.url, t.windowId])).toEqual([[500, 'https://first', 90], [501, 'https://second', 90]])
  })

  it('a non-incognito group reopens in a normal window; a script url is never reopened', async () => {
    stubChrome(new Map(), [])
    await runLiveTabsEffect({ kind: 'reopen', tabs: [rec(1, 'https://ok', { windowId: undefined }), rec(2, 'javascript:alert(1)')] })
    expect(c.windows.create).toHaveBeenCalledWith({ url: ['https://ok'], focused: false })
  })

  it('nothing to reopen gives no inverse', async () => {
    stubChrome(new Map())
    expect(await runLiveTabsEffect({ kind: 'reopen', tabs: [rec(1, 'data:text/html,x')] })).toBeNull()
  })
})

describe('runLiveTabsEffect — close (Redo of a drag out, Undo of a drop into Now Open)', () => {
  it('closes exactly the recorded ids and returns a reopen for them', async () => {
    const open = new Map([[500, 'https://b'], [77, 'https://b']]) // 77: an unrelated tab at the SAME url
    stubChrome(open)
    const inverse = await runLiveTabsEffect({ kind: 'close', tabs: [rec(500, 'https://b')] })
    expect(c.tabs.remove).toHaveBeenCalledWith([500])
    expect(open.has(77)).toBe(true) // never matched by URL
    expect(inverse).toEqual({ kind: 'reopen', tabs: [{ tabId: 500, url: 'https://b', windowId: 7, index: 0, pinned: false, incognito: false }] })
  })

  it('a reopened tab the user has since CLOSED is skipped: no failure, nothing else closed', async () => {
    const open = new Map([[77, 'https://b']])
    stubChrome(open)
    const inverse = await runLiveTabsEffect({ kind: 'close', tabs: [rec(500, 'https://b')] })
    expect(c.tabs.remove).not.toHaveBeenCalled()
    expect(open.has(77)).toBe(true)
    expect(inverse).toBeNull()
  })

  it('a reopened tab the user has since NAVIGATED is left open (it is theirs now); the others still close', async () => {
    const open = new Map([[500, 'https://elsewhere.example/'], [501, 'https://c']])
    stubChrome(open)
    const inverse = await runLiveTabsEffect({ kind: 'close', tabs: [rec(500, 'https://b'), rec(501, 'https://c')] })
    expect(c.tabs.remove).toHaveBeenCalledWith([501])
    expect(open.has(500)).toBe(true)
    expect(inverse?.tabs.map((t) => t.tabId)).toEqual([501])
  })

  it('a tab still loading counts by its pending url', async () => {
    stubChrome(new Map())
    c.tabs.get = vi.fn().mockResolvedValue({ id: 500, url: '', pendingUrl: 'https://b', windowId: 7, index: 2 })
    await runLiveTabsEffect({ kind: 'close', tabs: [rec(500, 'https://b')] })
    expect(c.tabs.remove).toHaveBeenCalledWith([500])
  })

  it('a failing browser call never throws out of undo/redo', async () => {
    stubChrome(new Map([[500, 'https://b']]))
    c.tabs.remove = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(runLiveTabsEffect({ kind: 'close', tabs: [rec(500, 'https://b')] })).resolves.toBeNull()
  })

  it('does nothing without the chrome API', async () => {
    vi.stubGlobal('chrome', undefined)
    await expect(runLiveTabsEffect({ kind: 'close', tabs: [rec(1, 'https://a')] })).resolves.toBeNull()
  })
})

describe('pending effects (the ids of opened tabs arrive after the step is recorded)', () => {
  const entry = (): GroupsState => ({ active: { id: '', index: 0 }, available: [] })

  it('an entry can be tagged with the promise of its effect; settledEntryEffect waits for it', async () => {
    const e = entry()
    let give!: (effect: { kind: 'close'; tabs: LiveTabRecord[] }) => void
    tagHistoryEntry(e, new Promise((resolve) => { give = resolve }))
    const settled = settledEntryEffect(e)
    give({ kind: 'close', tabs: [rec(900, 'https://example.com/a')] })
    await expect(settled).resolves.toMatchObject({ kind: 'close', tabs: [{ tabId: 900 }] })
  })

  it('a promise that settles with no tabs, null, or a rejection is no effect', async () => {
    const a = entry()
    const b = entry()
    const c = entry()
    tagHistoryEntry(a, Promise.resolve({ kind: 'close', tabs: [] }))
    tagHistoryEntry(b, Promise.resolve(null))
    const failing = Promise.reject(new Error('x'))
    failing.catch(() => undefined)
    tagHistoryEntry(c, failing)
    await expect(settledEntryEffect(a)).resolves.toBeNull()
    await expect(settledEntryEffect(b)).resolves.toBeNull()
    await expect(settledEntryEffect(c)).resolves.toBeNull()
    await expect(settledEntryEffect(entry())).resolves.toBeNull()
  })

  it('waits at most EFFECT_WAIT_MS for an effect that never arrives', async () => {
    vi.useFakeTimers()
    try {
      const e = entry()
      tagHistoryEntry(e, new Promise(() => {}))
      const settled = settledEntryEffect(e)
      await vi.advanceTimersByTimeAsync(EFFECT_WAIT_MS)
      await expect(settled).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a known effect is returned as it is', async () => {
    const e = entry()
    const effect = { kind: 'reopen' as const, tabs: [rec(5, 'https://example.com/b')] }
    tagHistoryEntry(e, effect)
    await expect(settledEntryEffect(e)).resolves.toBe(effect)
  })
})
