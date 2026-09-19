/**
 * overlayDismissOnSelection.test.tsx — "multi select should cancel out any other
 * dropdown/picker".
 *
 * Entering selection mode must close every transient overlay that would otherwise float
 * over the rows about to grow checkboxes. This file drives the REAL `uiStore` (the other
 * component suites stub it with a bare selector, which cannot deliver the nonce) and
 * covers one of each overlay KIND:
 *
 *  - a dropdown menu       → the window header's "More window options"
 *  - a context menu        → the window header's right-click menu
 *  - an inline editor      → the window's note textarea
 *  - a popover/picker      → the sidebar group row's colour picker
 *
 * `TabItem` and `WindowsPanel` call `useCloseOnOverlayDismiss` the same way for their own
 * context menu / note / reminder editors and panel menu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowItem } from '@/components/Windows/Window'
import { GroupItem } from '@/components/SidePanel/GroupItem'
import { useUIStore } from '@/stores/uiStore'
import type { Window as WindowType, Group, GroupsState } from '@/lib/types'

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: null, isDragging: false }),
}))
vi.mock('@dnd-kit/core', () => ({ useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }) }))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))

vi.mock('@/hooks/useGroups', () => ({
  useDeleteWindow: () => ({ mutate: vi.fn() }),
  useUpdateWindowName: () => ({ mutate: vi.fn() }),
  useUpdateWindowNote: () => ({ mutate: vi.fn() }),
  useToggleWindowStarred: () => ({ mutate: vi.fn() }),
  useToggleWindowIncognito: () => ({ mutate: vi.fn() }),
  useMoveWindow: () => ({ mutate: vi.fn() }),
  useSortTabs: () => ({ mutate: vi.fn() }),
  useUpdateGroupName: () => ({ mutate: vi.fn() }),
  useUpdateGroupColor: () => ({ mutate: vi.fn() }),
  useToggleGroupStar: () => ({ mutate: vi.fn() }),
  useDeleteGroup: () => ({ mutate: vi.fn() }),
  useGroups: () => ({ data: groupsState }),
}))
vi.mock('@/hooks/useOpenWindow', () => ({ useOpenWindow: () => vi.fn() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ maxGroups: 5, cloudSync: false }) }))
vi.mock('@/lib/localDb', () => ({ getSetting: vi.fn().mockResolvedValue({ confirmOnDelete: false }), setSetting: vi.fn() }))
vi.mock('@/components/Windows/Tab', () => ({
  TabItem: ({ tab }: { tab: { title: string } }) => React.createElement('div', null, tab.title),
}))
// The sidebar row's context menu is exercised through WindowItem; here the wrapper only
// needs to render its children so the colour picker is reachable.
vi.mock('@/components/SidePanel/GroupContextMenu', () => ({
  GroupContextMenu: ({ children, wrapperRef, onWrapperClick }: {
    children: React.ReactNode
    wrapperRef?: (node: HTMLElement | null) => void
    onWrapperClick?: React.MouseEventHandler<HTMLDivElement>
  }) => React.createElement('div', { ref: wrapperRef, onClick: onWrapperClick }, children),
}))

class MockResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(target: Element) { this.cb([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver) }
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

const windowFixture: WindowType = {
  id: 1,
  tabs: [{ id: 0, title: 'Alpha', url: 'https://example.com/a' }],
  incognito: false,
  focused: false,
  starred: false,
  note: 'hi',
}
const group: Group = {
  id: 'g1',
  name: 'Work',
  color: 'rgba(59,130,246,1)',
  updatedAt: 0,
  windows: [windowFixture],
}
let groupsState: GroupsState = { active: { id: 'g1', index: 0 }, available: [group] }

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(TooltipProvider, null, ui)))
}

const renderWindow = () =>
  wrap(
    React.createElement(WindowItem, {
      groupId: 'g1',
      window: windowFixture,
      groupIndex: 0,
      windowIndex: 0,
      siblingCount: 2,
      tabIds: ['g1::w0::t0'],
    })
  )

/** Enter selection mode the way the header's "Select items" button does. */
const enterSelectionMode = () => act(() => useUIStore.getState().toggleSelectionMode())

const initial = useUIStore.getState()
beforeEach(() => {
  groupsState = { active: { id: 'g1', index: 0 }, available: [group] }
  useUIStore.setState({ ...initial, selectionMode: false, selectedItems: [], selectionAnchor: null, overlayDismissNonce: 0 })
})
afterEach(cleanup)

describe('entering selection mode closes open overlays', () => {
  it('closes a DROPDOWN MENU (window "More options")', async () => {
    const user = userEvent.setup()
    renderWindow()
    await user.click(screen.getByRole('button', { name: /more window options/i }))
    expect(await screen.findByText('Mark incognito')).toBeTruthy()

    enterSelectionMode()
    await waitFor(() => expect(screen.queryByText('Mark incognito')).toBeNull())
  })

  it('closes a CONTEXT MENU (right-click on the window header)', async () => {
    renderWindow()
    fireEvent.contextMenu(screen.getByRole('toolbar'))
    expect(await screen.findByText('Rename window')).toBeTruthy()

    enterSelectionMode()
    await waitFor(() => expect(screen.queryByText('Rename window')).toBeNull())
  })

  it('closes an INLINE EDITOR (the window note textarea)', async () => {
    const user = userEvent.setup()
    renderWindow()
    await user.click(screen.getByRole('button', { name: /edit window note/i }))
    expect(await screen.findByPlaceholderText('Add a note…')).toBeTruthy()

    enterSelectionMode()
    await waitFor(() => expect(screen.queryByPlaceholderText('Add a note…')).toBeNull())
  })

  it('closes a POPOVER/PICKER (the sidebar group colour picker)', async () => {
    const user = userEvent.setup()
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    await user.click(screen.getByRole('button', { name: /change group colour|change group color/i }))
    // The picker is a grid of unlabelled swatch buttons, so assert on the popper layer.
    await waitFor(() => expect(document.querySelector('[data-radix-popper-content-wrapper]')).not.toBeNull())

    enterSelectionMode()
    await waitFor(() =>
      expect(document.querySelector('[data-radix-popper-content-wrapper]')).toBeNull()
    )
  })

  it('selecting the FIRST item also closes an overlay, and later items do not reopen anything', async () => {
    const user = userEvent.setup()
    renderWindow()
    await user.click(screen.getByRole('button', { name: /more window options/i }))
    expect(await screen.findByText('Mark incognito')).toBeTruthy()

    // Already in selection mode: the trigger is ticking the FIRST item.
    act(() => useUIStore.setState({ selectionMode: true }))
    act(() => useUIStore.getState().toggleSelection({ type: 'tab', id: 'tab-0-0-0' }))
    await waitFor(() => expect(screen.queryByText('Mark incognito')).toBeNull())
    expect(useUIStore.getState().overlayDismissNonce).toBe(1)

    act(() => useUIStore.getState().toggleSelection({ type: 'tab', id: 'tab-0-0-1' }))
    expect(useUIStore.getState().overlayDismissNonce).toBe(1)
  })
})
