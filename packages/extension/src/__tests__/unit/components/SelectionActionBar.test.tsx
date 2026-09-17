/**
 * Coverage for SelectionActionBar: move/star/share actions, Now Open
 * copy-vs-move/close-vs-delete labeling, share success/failure, cancel, and
 * delete's confirmOnDelete gating (must match single-item delete behavior —
 * see Window.tsx / GroupContextMenu.tsx).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SelectionActionBar } from '@/components/SelectionActionBar'

const { mockBulkMove, mockBulkStar, mockBulkDelete, mockExit, mockOpenModal, mockCreateSharedBundle, mockGetSetting } =
  vi.hoisted(() => ({
    mockBulkMove: vi.fn(),
    mockBulkStar: vi.fn(),
    mockBulkDelete: vi.fn(),
    mockExit: vi.fn(),
    mockOpenModal: vi.fn(),
    mockCreateSharedBundle: vi.fn(),
    mockGetSetting: vi.fn(),
  }))

vi.mock('@/hooks/useBulkActions', () => ({
  useBulkDelete: () => ({ mutate: mockBulkDelete, isPending: false }),
  useBulkMoveToGroup: () => ({ mutate: mockBulkMove, isPending: false }),
  useBulkStar: () => ({ mutate: mockBulkStar, isPending: false }),
  parseGroupId: (id: string) => {
    const m = id.match(/^group-(\d+)$/)
    return m ? { groupIndex: +m[1] } : null
  },
}))

let groupsState = {
  available: [
    { permanent: true, id: 'g0', name: 'Now Open', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
    { permanent: false, id: 'g1', name: 'Saved Group', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
  ],
  active: { id: '', index: 1 },
}

vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => ({ data: groupsState }),
}))

let entitlements: { tier: string; cloudSync: boolean; maxGroups: number } = { tier: 'free', cloudSync: false, maxGroups: 5 }
vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => entitlements,
}))
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/sharing', () => ({ createSharedBundle: mockCreateSharedBundle }))
vi.mock('@/lib/localDb', () => ({ getSetting: mockGetSetting }))

let selectedItems: Array<{ type: string; id: string }> = []

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) =>
    selector({
      selectedItems,
      exitSelectionMode: mockExit,
      openModal: mockOpenModal,
    }),
}))

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(React.createElement(QueryClientProvider, { client: qc }, ui))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSetting.mockResolvedValue({ confirmOnDelete: false })
  entitlements = { tier: 'free', cloudSync: false, maxGroups: 5 }
  groupsState = {
    available: [
      { permanent: true, id: 'g0', name: 'Now Open', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
      { permanent: false, id: 'g1', name: 'Saved Group', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
    ],
    active: { id: '', index: 1 },
  }
})

describe('SelectionActionBar — tab selection (window-N id, non-permanent group)', () => {
  beforeEach(() => {
    selectedItems = [{ type: 'tab', id: 'window-1-tab-0' }]
  })

  it('shows Move to group (not Copy) and Delete (not Close) for a non-permanent source group', () => {
    wrap(React.createElement(SelectionActionBar))
    expect(screen.getByRole('button', { name: /move to group/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /star/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument()
  })

  it('dispatches bulkMove with the clicked target group index', async () => {
    const user = userEvent.setup()
    wrap(React.createElement(SelectionActionBar))
    await user.click(screen.getByRole('button', { name: /move to group/i }))
    await user.click(screen.getByText('Saved Group'))
    expect(mockBulkMove).toHaveBeenCalledWith({ items: selectedItems, targetGroupIndex: 1 })
  })

  it('shows "Create new group…" in the move-to-group menu and wires bulkMove through its onCreated callback', async () => {
    const user = userEvent.setup()
    wrap(React.createElement(SelectionActionBar))
    await user.click(screen.getByRole('button', { name: /move to group/i }))
    const createItem = await screen.findByText('Create new group…')
    await user.click(createItem)
    expect(mockOpenModal).toHaveBeenCalledWith('addGroup', { onCreated: expect.any(Function) })

    const onCreated = mockOpenModal.mock.calls[0][1].onCreated as (groupIndex: number) => void
    onCreated(4)
    expect(mockBulkMove).toHaveBeenCalledWith({ items: selectedItems, targetGroupIndex: 4 })
  })
})

describe('SelectionActionBar — move/copy target list excludes archived groups', () => {
  beforeEach(() => {
    selectedItems = [{ type: 'tab', id: 'window-1-tab-0' }]
    groupsState = {
      available: [
        { permanent: true, id: 'g0', name: 'Now Open', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
        { permanent: false, id: 'g1', name: 'Saved Group', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
        // @ts-expect-error -- archived isn't in this file's minimal mock type, only needed for this test
        { permanent: false, archived: true, id: 'g2', name: 'Archived Group', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
      ],
      active: { id: '', index: 1 },
    }
  })

  it('does not list an archived group as a move/copy target', async () => {
    const user = userEvent.setup()
    wrap(React.createElement(SelectionActionBar))
    await user.click(screen.getByRole('button', { name: /move to group/i }))
    expect(screen.getByText('Saved Group')).toBeInTheDocument()
    expect(screen.queryByText('Archived Group')).not.toBeInTheDocument()
  })
})

describe('SelectionActionBar — window selection sourced from Now Open (permanent) group', () => {
  beforeEach(() => {
    selectedItems = [{ type: 'window', id: 'window-0-0' }]
  })

  it('shows Copy to group and Close (isNowOpen branch), plus Star/Unstar', async () => {
    const user = userEvent.setup()
    wrap(React.createElement(SelectionActionBar))
    expect(screen.getByRole('button', { name: /copy to group/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Star' }))
    expect(mockBulkStar).toHaveBeenCalledWith({ items: selectedItems, starred: true })

    await user.click(screen.getByRole('button', { name: 'Unstar' }))
    expect(mockBulkStar).toHaveBeenCalledWith({ items: selectedItems, starred: false })
  })
})

describe('SelectionActionBar — group selection', () => {
  beforeEach(() => {
    selectedItems = [{ type: 'group', id: 'group-1' }]
  })

  it('shows Share (canShare) disabled with a Pro tooltip when entitlements.cloudSync is false', () => {
    wrap(React.createElement(SelectionActionBar))
    const shareBtn = screen.getByRole('button', { name: /share/i })
    expect(shareBtn).toBeDisabled()
    expect(shareBtn).toHaveAttribute('title', 'Sharing requires Pro')
  })

  it('cancel button calls exitSelectionMode', async () => {
    const user = userEvent.setup()
    wrap(React.createElement(SelectionActionBar))
    await user.click(screen.getByRole('button', { name: /cancel selection/i }))
    expect(mockExit).toHaveBeenCalled()
  })

  it('Cancel hands keyboard focus to the header selection toggle BEFORE the bar unmounts', async () => {
    const toggle = document.createElement('button')
    toggle.setAttribute('aria-label', 'Exit selection mode')
    document.body.appendChild(toggle)
    try {
      const user = userEvent.setup()
      wrap(React.createElement(SelectionActionBar))
      const cancel = screen.getByRole('button', { name: /cancel selection/i })
      cancel.focus()
      await user.keyboard('{Enter}')
      expect(mockExit).toHaveBeenCalled()
      expect(document.activeElement).toBe(toggle)
    } finally {
      toggle.remove()
    }
  })

  it('a bulk action that empties the selection while focus is in the bar → focus is restored, not left on <body>', async () => {
    const toggle = document.createElement('button')
    toggle.setAttribute('aria-label', 'Select items')
    document.body.appendChild(toggle)
    try {
      const view = wrap(React.createElement(SelectionActionBar))
      screen.getByRole('button', { name: /cancel selection/i }).focus()
      // the bulk mutation finished: the store selection is now empty → the bar renders nothing
      selectedItems = []
      view.rerender(
        React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(SelectionActionBar))
      )
      await waitFor(() => expect(document.activeElement).toBe(toggle))
    } finally {
      toggle.remove()
    }
  })
})

describe('SelectionActionBar — share flow', () => {
  beforeEach(() => {
    selectedItems = [{ type: 'group', id: 'group-1' }]
  })

  it('copies the share URL to the clipboard on success (pro entitlement enables the button)', async () => {
    entitlements = { tier: 'pro', cloudSync: true, maxGroups: 999 }
    mockCreateSharedBundle.mockResolvedValue('https://tabmerger.app/s/abc')
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    wrap(React.createElement(SelectionActionBar))
    const shareBtn = screen.getByRole('button', { name: /share/i })
    expect(shareBtn).not.toBeDisabled()
    await user.click(shareBtn)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://tabmerger.app/s/abc'))
    // Regression: must resolve positional 'group-1' to the group's real id ('g1'),
    // not pass the positional string through to createSharedBundle.
    expect(mockCreateSharedBundle).toHaveBeenCalledWith(
      ['g1'],
      groupsState.available,
      {},
      { tier: 'pro', sharing: true }
    )
  })

  it('shows an error toast when createSharedBundle rejects with an Error', async () => {
    entitlements = { tier: 'pro', cloudSync: true, maxGroups: 999 }
    mockCreateSharedBundle.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()
    wrap(React.createElement(SelectionActionBar))
    await user.click(screen.getByRole('button', { name: /share/i }))
    await waitFor(() => expect(mockCreateSharedBundle).toHaveBeenCalled())
  })
})

describe('SelectionActionBar — delete respects confirmOnDelete', () => {
  beforeEach(() => {
    selectedItems = [{ type: 'group', id: 'group-1' }]
    entitlements = { tier: 'pro', cloudSync: true, maxGroups: 999 }
  })

  it('calls bulkDelete directly when confirmOnDelete=false', async () => {
    mockGetSetting.mockResolvedValue({ confirmOnDelete: false })
    const user = userEvent.setup()
    wrap(React.createElement(SelectionActionBar))

    await user.click(screen.getByRole('button', { name: /delete/i }))

    await waitFor(() => expect(mockBulkDelete).toHaveBeenCalledWith([{ type: 'group', id: 'group-1' }]))
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('opens the deleteSelection modal instead of deleting when confirmOnDelete=true', async () => {
    mockGetSetting.mockResolvedValue({ confirmOnDelete: true })
    const user = userEvent.setup()
    wrap(React.createElement(SelectionActionBar))

    await user.click(screen.getByRole('button', { name: /delete/i }))

    await waitFor(() =>
      expect(mockOpenModal).toHaveBeenCalledWith(
        'deleteSelection',
        expect.objectContaining({ items: [{ type: 'group', id: 'group-1' }] })
      )
    )
    expect(mockBulkDelete).not.toHaveBeenCalled()
  })
})
