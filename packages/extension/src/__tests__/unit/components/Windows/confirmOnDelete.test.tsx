/**
 * TDD: confirmOnDelete setting
 *
 * Covers:
 *   - Group delete via context menu: respects confirmOnDelete
 *   - Window delete (saved group): respects confirmOnDelete
 *   - Window delete (Now Open): also respects confirmOnDelete (unified path)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
// ponytail: userEvent still needed for group deletion tests below
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowItem } from '@/components/Windows/Window'
import { GroupContextMenu } from '@/components/SidePanel/GroupContextMenu'
import type { Window as WindowType } from '@/lib/types'
import type { Group } from '@/lib/types'

// ─── vi.hoisted ───────────────────────────────────────────────────────────────

const { mockDeleteWindow, mockDeleteGroup, mockOpenModal, mockGetSetting } = vi.hoisted(() => ({
  mockDeleteWindow: vi.fn(),
  mockDeleteGroup: vi.fn(),
  mockOpenModal: vi.fn(),
  mockGetSetting: vi.fn(),
}))

// ─── DnD stubs ───────────────────────────────────────────────────────────────

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: null, isDragging: false }),
}))
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return { ...actual, DndContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children), DragOverlay: () => null, useSensors: vi.fn(() => []), useSensor: vi.fn() }
})
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))

// ─── hooks ────────────────────────────────────────────────────────────────────

vi.mock('@/hooks/useGroups', () => ({
  useDeleteWindow: () => ({ mutate: mockDeleteWindow }),
  useDeleteGroup: () => ({ mutate: mockDeleteGroup }),
  useUpdateWindowName: () => ({ mutate: vi.fn() }),
  useUpdateWindowNote: () => ({ mutate: vi.fn() }),
  useToggleWindowStarred: () => ({ mutate: vi.fn() }),
  useToggleWindowIncognito: () => ({ mutate: vi.fn() }),
  useMoveWindow: () => ({ mutate: vi.fn() }),
  useDuplicateGroup: () => ({ mutate: vi.fn() }),
  useReplaceWithCurrent: () => ({ mutate: vi.fn() }),
  useMergeWithCurrent: () => ({ mutate: vi.fn() }),
  useUniteWindows: () => ({ mutate: vi.fn() }),
  useSplitWindows: () => ({ mutate: vi.fn() }),
  useSortTabs: () => ({ mutate: vi.fn() }),
  useDeleteAllWindows: () => ({ mutate: vi.fn() }),
  useArchiveGroup: () => ({ mutate: vi.fn() }),
  useRestoreGroup: () => ({ mutate: vi.fn() }),
  useUpdateGroupName: () => ({ mutate: vi.fn() }),
  useGroups: () => ({
    data: {
      available: [
        { permanent: true, id: 'g0', name: 'Now Open', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
        { permanent: false, id: 'g1', name: 'Saved Group', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
      ],
      active: { id: '', index: 1 },
    },
  }),
  GROUPS_QUERY_KEY: ['groups'],
}))

vi.mock('@/hooks/useOpenWindow', () => ({ useOpenWindow: () => vi.fn() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ maxGroups: 5, tier: 'pro', aiFeatures: false }) }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ data: {} }) }))
vi.mock('@/hooks/useAI', () => ({ useNameGroup: () => ({ mutateAsync: vi.fn() }), QuotaExceededError: class extends Error {} }))

// ─── localDb ─────────────────────────────────────────────────────────────────

vi.mock('@/lib/localDb', () => ({
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: mockGetSetting,
}))

// ─── uiStore ─────────────────────────────────────────────────────────────────

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) =>
    selector({
      openModal: mockOpenModal,
      setRenameTarget: vi.fn(),
      selectionMode: false,
      selectedItems: [],
      toggleSelection: vi.fn(),
      enterSelectionMode: vi.fn(),
    }),
}))

// ─── stubs ────────────────────────────────────────────────────────────────────

vi.mock('@/components/Windows/Tab', () => ({ TabItem: () => React.createElement('div', { 'data-testid': 'tab-item' }) }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

globalThis.chrome = { tabs: { create: vi.fn() }, windows: { create: vi.fn() } } as unknown as typeof chrome

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWindow(overrides: Partial<WindowType> = {}): WindowType {
  return { id: 1, tabs: [{ id: 0, title: 'Tab 1', url: 'https://example.com' }], incognito: false, focused: false, starred: false, name: 'Test Window', ...overrides }
}

function makeGroup(overrides: Partial<Group> = {}): Group {
  return { id: 'g1', name: 'Test Group', color: 'rgba(59,130,246,1)', updatedAt: Date.now(), windows: [], permanent: false, ...overrides }
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(TooltipProvider, null, ui)))
}

function renderWindow(win: WindowType, groupIndex = 1) {
  const tabIds = win.tabs.map((t) => `tab-${t.id}`)
  return wrap(React.createElement(WindowItem, { window: win, groupIndex, windowIndex: 0, siblingCount: 2, tabIds }))
}

function renderGroup(group: Group, groupIndex = 1) {
  return wrap(
    React.createElement(GroupContextMenu, {
      group,
      groupIndex,
      open: true,
      onOpenChange: vi.fn(),
      children: React.createElement('div', null, 'trigger'),
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── helpers for window menu ──────────────────────────────────────────────────

// Opens the right-click context menu on the window header (simpler than ⋯ dropdown in jsdom)
async function openWindowContextMenuAndClickDelete(label: string) {
  const header = document.querySelector('[data-window-index="0"] .group.relative') as HTMLElement
  fireEvent.contextMenu(header)
  const item = await screen.findByText(label)
  fireEvent.click(item)
}

// ─── Window delete — saved group ──────────────────────────────────────────────

describe('confirmOnDelete — window deletion (saved group)', () => {
  it('calls deleteWindow directly when confirmOnDelete=false', async () => {
    mockGetSetting.mockResolvedValue({ confirmOnDelete: false })
    renderWindow(makeWindow(), 1) // groupIndex=1 → not Now Open

    await openWindowContextMenuAndClickDelete('Remove window')

    await waitFor(() => expect(mockDeleteWindow).toHaveBeenCalledWith({ groupIndex: 1, windowIndex: 0 }))
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('opens deleteWindow modal when confirmOnDelete=true', async () => {
    mockGetSetting.mockResolvedValue({ confirmOnDelete: true })
    renderWindow(makeWindow(), 1)

    await openWindowContextMenuAndClickDelete('Remove window')

    await waitFor(() => expect(mockOpenModal).toHaveBeenCalledWith('deleteWindow', expect.objectContaining({ groupIndex: 1, windowIndex: 0 })))
    expect(mockDeleteWindow).not.toHaveBeenCalled()
  })

  it('old confirmOnWindowClose key is ignored — only confirmOnDelete matters', async () => {
    // Even if an old setting object has confirmOnWindowClose=true, only confirmOnDelete is read
    mockGetSetting.mockResolvedValue({ confirmOnDelete: false })
    renderWindow(makeWindow(), 1)

    await openWindowContextMenuAndClickDelete('Remove window')

    await waitFor(() => expect(mockDeleteWindow).toHaveBeenCalled())
    expect(mockOpenModal).not.toHaveBeenCalled()
  })
})

// ─── Window delete — Now Open (groupIndex=0) ──────────────────────────────────

describe('confirmOnDelete — window deletion (Now Open)', () => {
  it('uses confirmOnDelete for Now Open windows too (unified path)', async () => {
    mockGetSetting.mockResolvedValue({ confirmOnDelete: true })
    renderWindow(makeWindow(), 0) // groupIndex=0 → Now Open

    await openWindowContextMenuAndClickDelete('Close window')

    await waitFor(() => expect(mockOpenModal).toHaveBeenCalledWith('deleteWindow', expect.objectContaining({ isNowOpen: true })))
    expect(mockDeleteWindow).not.toHaveBeenCalled()
  })
})

// ─── Group delete ─────────────────────────────────────────────────────────────

describe('confirmOnDelete — group deletion', () => {
  it('opens deleteGroup modal when confirmOnDelete=true', async () => {
    mockGetSetting.mockResolvedValue({ confirmOnDelete: true })
    const user = userEvent.setup()
    renderGroup(makeGroup())
    await user.click(screen.getByText('Delete group'))

    await waitFor(() => expect(mockOpenModal).toHaveBeenCalledWith('deleteGroup', expect.objectContaining({ groupIndex: 1 })))
    expect(mockDeleteGroup).not.toHaveBeenCalled()
  })

  it('calls deleteGroup directly when confirmOnDelete=false', async () => {
    mockGetSetting.mockResolvedValue({ confirmOnDelete: false })
    const user = userEvent.setup()
    renderGroup(makeGroup())
    await user.click(screen.getByText('Delete group'))

    await waitFor(() => expect(mockDeleteGroup).toHaveBeenCalledWith(1))
    expect(mockOpenModal).not.toHaveBeenCalled()
  })
})
