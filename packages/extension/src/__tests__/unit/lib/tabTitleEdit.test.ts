/**
 * Feature 66 — Tab title editing (extension)
 *
 * Covers the data-model rename: a custom title saved to a tab in IndexedDB and
 * displayed in TabMerger's own UI. This is independent of any live-browser-tab
 * DOM write — that path (notifySavedTabTitle / SET_TAB_TITLE) was removed
 * entirely; custom titles never propagate to the actual open tab's document.title.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
// ponytail: these exports don't exist yet — imports will fail (red phase)
import { saveCustomTitle, getDisplayTitle } from '@/lib/tabTitle'
import type { Tab, GroupsState } from '@/lib/types'

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
    // N5: the edit is a sync-visible change to a saved group (it used to be neither pushed nor kept)
    expect(workGroup.pendingSync).toBe(true)
    expect(workGroup.updatedAt).toBeGreaterThan(2)
  })

  it('does not mark Now Open (permanent, never synced)', async () => {
    const mockState = await (getGroupsState as unknown as () => Promise<GroupsState>)()
    mockState.available[0].windows = [{ id: 5, tabs: [{ id: 77, title: 'Live', url: 'https://live.com' }], incognito: false, focused: false }]
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockState)
    await saveCustomTitle(77, 'X')
    const state = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(state.available[0].pendingSync).toBeUndefined()
  })

  it('removes customTitle when saved with an empty string', async () => {
    // Pre-seed a tab that already has a customTitle
    const mockState = await (getGroupsState as unknown as () => Promise<GroupsState>)()
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
