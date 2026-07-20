import { describe, it, expect, vi } from 'vitest'
import { chromeTabToTab } from '@/hooks/useCurrentTabs'

// chromeTabToTab is a pure mapping function — no chrome API calls, just reads from the map.
// The module imports useQueryClient via useCurrentTabs export, so we mock the deps it pulls in.
vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn(),
  getGroupsState: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(() => ({ setQueryData: vi.fn() })),
}))

// chrome.tabGroups.query is referenced at module evaluation; stub minimally
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
  tabGroups: {
    query: vi.fn(),
  },
} as unknown as typeof chrome

function makeGroup(overrides: Partial<chrome.tabGroups.TabGroup> = {}): chrome.tabGroups.TabGroup {
  return {
    id: 5,
    title: 'Work',
    color: 'blue' as chrome.tabGroups.Color,
    windowId: 1,
    collapsed: false,
    shared: false,
    ...overrides,
  }
}

function makeChromeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: true,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    title: 'My Tab',
    url: 'https://example.com',
    favIconUrl: 'https://example.com/favicon.ico',
    ...overrides,
  } as chrome.tabs.Tab
}

describe('chromeTabToTab', () => {
  it('sets no chromeGroup when groupId is -1', () => {
    const t = makeChromeTab({ groupId: -1 })
    const result = chromeTabToTab(t, new Map())
    expect(result.chromeGroup).toBeUndefined()
  })

  it('sets no chromeGroup when groupId is undefined', () => {
    const t = makeChromeTab({ groupId: undefined as unknown as number })
    const result = chromeTabToTab(t, new Map())
    expect(result.chromeGroup).toBeUndefined()
  })

  it('sets chromeGroup when groupId matches an entry in groupMap', () => {
    const group = makeGroup({ id: 5, title: 'Work', color: 'blue' as chrome.tabGroups.Color })
    const map = new Map([[5, group]])
    const t = makeChromeTab({ groupId: 5 })
    const result = chromeTabToTab(t, map)
    expect(result.chromeGroup).toEqual({ id: 5, name: 'Work', color: 'blue' })
  })

  it('sets no chromeGroup when groupId is non-(-1) but not found in groupMap', () => {
    const map = new Map<number, chrome.tabGroups.TabGroup>() // empty
    const t = makeChromeTab({ groupId: 99 })
    const result = chromeTabToTab(t, map)
    expect(result.chromeGroup).toBeUndefined()
  })

  it('maps basic tab fields correctly', () => {
    const t = makeChromeTab({ id: 7, title: 'Hello', url: 'https://hello.com', pinned: true })
    const result = chromeTabToTab(t, new Map())
    expect(result.id).toBe(7)
    expect(result.title).toBe('Hello')
    expect(result.url).toBe('https://hello.com')
    expect(result.pinned).toBe(true)
  })

  it('uses 0 as id fallback when chrome tab id is undefined', () => {
    const t = makeChromeTab({ id: undefined })
    const result = chromeTabToTab(t, new Map())
    expect(result.id).toBe(0)
  })
})
