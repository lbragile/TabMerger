import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowItem } from '@/components/Windows/Window'
import { WindowAiScope } from '@/components/Windows/WindowAiScope'
import { windowTabsKey } from '@/lib/aiTarget'
import type { Group, Window as WindowType } from '@/lib/types'

/**
 * The window ⋯ menu's AI items ("AI rename", "Describe with AI"): shown with the same gating as the
 * group context menu's AI items (Pro AI with a live option = `aiFeatures`, the per-feature switch
 * on, never on Now Open), hidden otherwise; a click runs the shared action for THAT window.
 */

const h = vi.hoisted(() => ({
  entitlements: { aiFeatures: false } as Record<string, unknown>,
  settings: {} as Record<string, unknown>,
  groups: [] as Group[],
  runName: vi.fn(),
  runDescribe: vi.fn(),
  nameHookCalls: 0,
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: null, isDragging: false }),
}))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => h.entitlements }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ data: h.settings }) }))
vi.mock('@/hooks/useNameGroupAction', () => ({
  useNameAction: () => {
    h.nameHookCalls++
    return { run: h.runName, isPending: false }
  },
}))
vi.mock('@/hooks/useDescribeGroupAction', () => ({ useDescribeAction: () => ({ run: h.runDescribe, isPending: false }) }))
vi.mock('@/hooks/useOpenWindow', () => ({ useOpenWindow: () => vi.fn() }))
vi.mock('@/hooks/useGroups', () => ({
  useDeleteWindow: () => ({ mutate: vi.fn() }),
  useUpdateWindowName: () => ({ mutate: vi.fn() }),
  useUpdateWindowNote: () => ({ mutate: vi.fn() }),
  useToggleWindowStarred: () => ({ mutate: vi.fn() }),
  useToggleWindowIncognito: () => ({ mutate: vi.fn() }),
  useMoveWindow: () => ({ mutate: vi.fn() }),
  useGroups: () => ({ data: { available: h.groups, active: { id: '', index: 0 } } }),
  useSortTabs: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/lib/localDb', () => ({ getSetting: vi.fn().mockResolvedValue({}) }))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) =>
    selector({ openModal: vi.fn(), selectionMode: false, selectedItems: [], toggleSelection: vi.fn(), enterSelectionMode: vi.fn() }),
}))
vi.mock('@/components/Windows/Tab', () => ({ TabItem: () => null }))

globalThis.chrome = { tabs: { create: vi.fn(), query: vi.fn() }, windows: { create: vi.fn() } } as unknown as typeof chrome

const tab = (title: string) => ({ id: 0, title, url: `https://${title.toLowerCase()}.example.com` })
const win = (overrides: Partial<WindowType> = {}): WindowType => ({
  id: 0, tabs: [tab('A'), tab('B')], incognito: false, focused: false, name: 'Reading', ...overrides,
})
const group = (overrides: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Research', color: 'rgba(0,0,0,1)', updatedAt: 1, windows: [win({ tabs: [tab('Z')] }), win()], ...overrides,
})

function renderWindow({ scoped = true, windowIndex = 1 }: { scoped?: boolean; windowIndex?: number } = {}) {
  const qc = new QueryClient()
  const w = h.groups[0].windows[windowIndex]
  const item = React.createElement(WindowItem, { groupId: h.groups[0].id, window: w, groupIndex: 0, windowIndex, siblingCount: 2, tabIds: [] })
  render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(TooltipProvider, null, scoped ? React.createElement(WindowAiScope, null, item) : item)
    )
  )
  return userEvent.setup()
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More window options' }))
}
const aiRename = () => screen.queryByRole('menuitem', { name: 'AI rename' })
const aiDescribe = () => screen.queryByRole('menuitem', { name: 'Describe with AI' })

beforeEach(() => {
  vi.clearAllMocks()
  h.entitlements = { tier: 'pro_ai', aiFeatures: true }
  h.settings = {}
  h.groups = [group()]
  h.nameHookCalls = 0
})

describe('window ⋯ menu — AI items gating (same as the group context menu)', () => {
  it.each([
    ['Free', { tier: 'free', aiFeatures: false }],
    ['Pro', { tier: 'pro', aiFeatures: false }],
    // A Pro AI subscription whose option (own key / managed) isn't live in this build: useEntitlements gives aiFeatures false
    ['Pro AI, option not live', { tier: 'pro_ai', aiFeatures: false }],
  ])('%s: both items hidden, and no AI hooks mounted', async (_label, entitlements) => {
    h.entitlements = entitlements
    const user = renderWindow()
    await openMenu(user)
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy()
    expect(aiRename()).toBeNull()
    expect(aiDescribe()).toBeNull()
    expect(h.nameHookCalls).toBe(0)
  })

  it('Pro AI (live): both items show, next to Rename and the note item', async () => {
    const user = renderWindow()
    await openMenu(user)
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent)
    expect(labels.indexOf('AI rename')).toBe(labels.indexOf('Rename') + 1)
    expect(labels.indexOf('Describe with AI')).toBe(labels.indexOf('Add note') + 1)
  })

  it('"Name groups and windows" off in Settings: only Describe shows', async () => {
    h.settings = { aiNameGroupEnabled: false }
    const user = renderWindow()
    await openMenu(user)
    expect(aiRename()).toBeNull()
    expect(aiDescribe()).toBeTruthy()
  })

  it('"Describe groups and windows" off in Settings: only AI rename shows', async () => {
    h.settings = { aiDescribeGroupEnabled: false }
    const user = renderWindow()
    await openMenu(user)
    expect(aiRename()).toBeTruthy()
    expect(aiDescribe()).toBeNull()
  })

  it('both switches off: no items and no AI hooks mounted', async () => {
    h.settings = { aiNameGroupEnabled: false, aiDescribeGroupEnabled: false }
    const user = renderWindow()
    await openMenu(user)
    expect(aiRename()).toBeNull()
    expect(aiDescribe()).toBeNull()
    expect(h.nameHookCalls).toBe(0)
  })

  it('a Now Open window: hidden (its name and note are rebuilt from the browser)', async () => {
    h.groups = [group({ permanent: true })]
    const user = renderWindow()
    await openMenu(user)
    expect(aiRename()).toBeNull()
    expect(aiDescribe()).toBeNull()
  })

  it('a window row outside the panel scope shows no AI items', async () => {
    const user = renderWindow({ scoped: false })
    await openMenu(user)
    expect(aiRename()).toBeNull()
  })
})

describe('window ⋯ menu — AI items run the shared actions for THAT window', () => {
  const expectedSubject = () => ({
    target: { kind: 'window', groupId: 'g1', windowIndex: 1, tabsKey: windowTabsKey(win()) },
    name: 'Reading',
    tabs: [tab('A'), tab('B')],
    permanent: false,
  })

  it('AI rename', async () => {
    const user = renderWindow()
    await openMenu(user)
    await user.click(aiRename()!)
    expect(h.runName).toHaveBeenCalledWith(expectedSubject())
    expect(h.runDescribe).not.toHaveBeenCalled()
  })

  it('Describe with AI', async () => {
    const user = renderWindow()
    await openMenu(user)
    await user.click(aiDescribe()!)
    expect(h.runDescribe).toHaveBeenCalledWith(expectedSubject())
    expect(h.runName).not.toHaveBeenCalled()
  })
})
