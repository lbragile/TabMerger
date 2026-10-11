/**
 * Feature 65 — URL filtering background listeners (extension)
 *
 * matchUrlToRule already exists — those tests may pass immediately (green).
 * applyUrlRule and the background listener behaviors do NOT exist yet — those
 * tests FAIL until implemented.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { matchUrlToRule } from '@/hooks/useUrlRules'
// ponytail: applyUrlRule doesn't exist yet — import will fail (red phase)
import { applyUrlRule } from '@/lib/urlRuleEngine'
import type { UrlRule } from '@/lib/types'

// ─── Mock localDb ─────────────────────────────────────────────────────────────

vi.mock('@/lib/localDb', async () => (await import('@/__tests__/unit/_helpers/updateGroupsStateMock')).withUpdateGroupsState({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  getGroupsState: vi.fn().mockResolvedValue({
    active: { id: 'g1', index: 0 },
    available: [
      {
        id: 'g1',
        name: 'Now Open',
        color: 'rgba(128,128,128,1)',
        updatedAt: 1,
        windows: [],
        permanent: true,
      },
      {
        id: 'g2',
        name: 'Work',
        color: 'rgba(59,130,246,1)',
        updatedAt: 2,
        windows: [{ id: 10, tabs: [], incognito: false, focused: false }],
      },
    ],
  }),
  getSetting: vi.fn(),
  setSetting: vi.fn().mockResolvedValue(undefined),
}))

import { getGroupsState, saveGroupsState } from '@/lib/localDb'

// ─── Chrome stubs ─────────────────────────────────────────────────────────────

const makeListener = () => ({ addListener: vi.fn(), removeListener: vi.fn() })

globalThis.chrome = {
  tabs: {
    query: vi.fn(),
    remove: vi.fn(),
    onCreated: makeListener(),
    onUpdated: makeListener(),
    onRemoved: makeListener(),
    onMoved: makeListener(),
    onDetached: makeListener(),
    onAttached: makeListener(),
  },
  windows: {
    getAll: vi.fn(),
    onCreated: makeListener(),
    onRemoved: makeListener(),
  },
  tabGroups: { query: vi.fn() },
} as unknown as typeof chrome

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRule(overrides: Partial<UrlRule> = {}): UrlRule {
  return {
    id: 'rule-1',
    pattern: 'github.com/*',
    groupId: 'g2',
    createdAt: Date.now(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── matchUrlToRule (pure function — already exists) ─────────────────────────

describe('matchUrlToRule — existing pure function', () => {
  it('matches an exact URL (no wildcard)', () => {
    const rules = [makeRule({ pattern: 'github.com/login' })]
    expect(matchUrlToRule('https://github.com/login', rules)).toBe('g2')
  })

  it('matches a wildcard pattern *.github.com', () => {
    const rules = [makeRule({ pattern: '*.github.com/*' })]
    expect(matchUrlToRule('https://gist.github.com/user/abc', rules)).toBe('g2')
  })

  it('matches github.com/* wildcard', () => {
    const rules = [makeRule({ pattern: 'github.com/*' })]
    expect(matchUrlToRule('https://github.com/torvalds/linux', rules)).toBe('g2')
  })

  it('returns null when no rule matches', () => {
    const rules = [makeRule({ pattern: 'github.com/*' })]
    expect(matchUrlToRule('https://google.com', rules)).toBeNull()
  })

  it('returns null for an empty rules array', () => {
    expect(matchUrlToRule('https://github.com', [])).toBeNull()
  })
})

// ─── applyUrlRule (does NOT exist yet) ────────────────────────────────────────

describe('applyUrlRule — Feature 65 background listener behavior', () => {
  it('saves the tab to the matched group via localDb', async () => {
    const tab = { id: 42, title: 'GitHub PR', url: 'https://github.com/pr/1' }
    await applyUrlRule(tab as chrome.tabs.Tab, 'g2')

    expect(saveGroupsState).toHaveBeenCalledOnce()
    const savedState = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const workGroup = savedState.available.find((g: { id: string }) => g.id === 'g2')
    expect(workGroup).toBeDefined()
    const allTabs = workGroup.windows.flatMap((w: { tabs: unknown[] }) => w.tabs)
    expect(allTabs).toContainEqual(expect.objectContaining({ url: 'https://github.com/pr/1' }))
  })

  it('saves a detached copy of the tab: id 0, stamped savedAt, no pinned flag', async () => {
    const tab = { id: 42, title: 'GitHub PR', url: 'https://github.com/pr/1', favIconUrl: 'https://github.com/f.ico', pinned: true }
    await applyUrlRule(tab as chrome.tabs.Tab, 'g2')

    const savedState = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const workGroup = savedState.available.find((g: { id: string }) => g.id === 'g2')
    const [saved] = workGroup.windows[0].tabs
    expect(saved).toEqual({
      id: 0,
      title: 'GitHub PR',
      url: 'https://github.com/pr/1',
      favIconUrl: 'https://github.com/f.ico',
      savedAt: expect.any(Number),
    })
    expect(workGroup.pendingSync).toBe(true)
  })

  it('does NOT call chrome.tabs.remove — tab stays open in browser', async () => {
    const tab = { id: 99, title: 'Test', url: 'https://github.com/test' }
    await applyUrlRule(tab as chrome.tabs.Tab, 'g2')
    expect(chrome.tabs.remove).not.toHaveBeenCalled()
  })

  it('does nothing when matchedGroupId is null', async () => {
    // passing null simulates "no rule matched" — should be a no-op
    await applyUrlRule({ id: 1, title: 'Foo', url: 'https://foo.com' } as chrome.tabs.Tab, null)
    expect(saveGroupsState).not.toHaveBeenCalled()
  })

  // Entitlements gate 2026-09-27: useSaveUrlRules blocks CREATING new rules past
  // maxUrlRules, but applyUrlRule (the engine that matches+applies already-saved rules)
  // takes no entitlements/tier input at all — a rule saved while on a paid plan keeps
  // matching and applying here after a downgrade to Free. This test doesn't need a
  // "downgraded" fixture because there's nothing in this function's signature to gate on.
  it('applies an already-saved rule regardless of tier (rules persist across a downgrade)', async () => {
    const tab = { id: 7, title: 'Repo', url: 'https://github.com/lbragile/repo' }
    await applyUrlRule(tab as chrome.tabs.Tab, 'g2')
    expect(saveGroupsState).toHaveBeenCalledOnce()
    const savedState = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const workGroup = savedState.available.find((g: { id: string }) => g.id === 'g2')
    const allTabs = workGroup.windows.flatMap((w: { tabs: unknown[] }) => w.tabs)
    expect(allTabs).toContainEqual(expect.objectContaining({ url: 'https://github.com/lbragile/repo' }))
  })
})

describe('matchUrlToRule — query string edge cases', () => {
  it('wildcard pattern matches URL that has a query string', () => {
    // github.com/* → regex github.com/.* which captures query strings too
    const rules = [makeRule({ pattern: 'github.com/*' })]
    expect(matchUrlToRule('https://github.com/pr/1?tab=files&ref=main', rules)).toBe('g2')
  })
})
