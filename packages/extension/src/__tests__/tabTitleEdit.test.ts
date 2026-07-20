/**
 * Feature 66 — Tab title editing (extension)
 *
 * ALL tests FAIL until:
 *  - Tab type gains `customTitle?: string`
 *  - saveCustomTitle(tabId, title) is implemented in localDb
 *  - getDisplayTitle(tab) is implemented
 *  - background sends SET_TAB_TITLE message when a saved tab is opened
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
// ponytail: these exports don't exist yet — imports will fail (red phase)
import { saveCustomTitle, getDisplayTitle } from '@/lib/tabTitle'
import type { Tab } from '@/lib/types'

// ─── Mock localDb ─────────────────────────────────────────────────────────────

vi.mock('@/lib/localDb', () => ({
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
        windows: [
          {
            id: 10,
            tabs: [
              { id: 1, title: 'GitHub', url: 'https://github.com' },
            ],
            incognito: false,
            focused: false,
          },
        ],
      },
    ],
  }),
  getSetting: vi.fn(),
  setSetting: vi.fn().mockResolvedValue(undefined),
}))

import { getGroupsState, saveGroupsState } from '@/lib/localDb'

// ─── Chrome stubs ─────────────────────────────────────────────────────────────

globalThis.chrome = {
  tabs: {
    sendMessage: vi.fn().mockResolvedValue({}),
    query: vi.fn(),
    onCreated: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    onMoved: { addListener: vi.fn(), removeListener: vi.fn() },
    onDetached: { addListener: vi.fn(), removeListener: vi.fn() },
    onAttached: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  windows: {
    getAll: vi.fn(),
    onCreated: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  tabGroups: { query: vi.fn() },
  runtime: { lastError: undefined },
} as unknown as typeof chrome

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 1,
    title: 'GitHub',
    url: 'https://github.com',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('saveCustomTitle — Feature 66', () => {
  it('updates the tab customTitle field in the saved group', async () => {
    await saveCustomTitle(1, 'My Custom Title')

    expect(saveGroupsState).toHaveBeenCalledOnce()
    const state = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const workGroup = state.available.find((g: { id: string }) => g.id === 'g2')
    const tab = workGroup.windows[0].tabs[0]
    expect(tab.customTitle).toBe('My Custom Title')
  })

  it('removes customTitle when saved with an empty string', async () => {
    // Pre-seed a tab that already has a customTitle
    const mockState = await (getGroupsState as ReturnType<typeof vi.fn>)()
    mockState.available[1].windows[0].tabs[0].customTitle = 'Old Title'
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockState)

    await saveCustomTitle(1, '')

    const state = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const tab = state.available[1].windows[0].tabs[0]
    expect(tab.customTitle).toBeUndefined()
  })
})

describe('getDisplayTitle — Feature 66', () => {
  it('returns customTitle when present', () => {
    const tab = makeTab({ customTitle: 'My Awesome Tab' })
    expect(getDisplayTitle(tab)).toBe('My Awesome Tab')
  })

  it('falls back to title when customTitle is absent', () => {
    const tab = makeTab()
    expect(getDisplayTitle(tab)).toBe('GitHub')
  })

  it('falls back to title when customTitle is empty string', () => {
    const tab = makeTab({ customTitle: '' })
    expect(getDisplayTitle(tab)).toBe('GitHub')
  })

  it('falls back to title when customTitle is whitespace-only', () => {
    // ponytail: "   ".trim() is "" — treat as no custom title
    const tab = makeTab({ customTitle: '   ' })
    expect(getDisplayTitle(tab)).toBe('GitHub')
  })
})

describe('SET_TAB_TITLE content script message — Feature 66', () => {
  it('sends SET_TAB_TITLE message with title and tabId when a saved tab is opened', async () => {
    // Simulates background notifying content script of a saved tab's customTitle
    // ponytail: import the function that registers this side effect
    const { notifySavedTabTitle } = await import('@/lib/tabTitle')

    await notifySavedTabTitle({ browserTabId: 55, customTitle: 'My Tab', tabId: 1 })

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      55,
      { type: 'SET_TAB_TITLE', title: 'My Tab', tabId: 1 }
    )
  })

  it('does not throw when sendMessage rejects (best-effort, fire-and-forget)', async () => {
    ;(chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Tab not found')
    )
    const { notifySavedTabTitle } = await import('@/lib/tabTitle')

    // Must not throw
    await expect(
      notifySavedTabTitle({ browserTabId: 99, customTitle: 'Test', tabId: 2 })
    ).resolves.not.toThrow()
  })
})
