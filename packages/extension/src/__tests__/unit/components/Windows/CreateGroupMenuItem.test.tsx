import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { CreateGroupMenuItem } from '@/components/Windows/CreateGroupMenuItem'

const { mockUseGroupsData, mockOpenModal, mockToastError, mockTrackEvent } = vi.hoisted(() => ({
  mockUseGroupsData: vi.fn(),
  mockOpenModal: vi.fn(),
  mockToastError: vi.fn(),
  mockTrackEvent: vi.fn(),
}))

vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => mockUseGroupsData(),
}))

let entitlements = { maxGroups: 5 }
vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => entitlements,
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: { openModal: typeof mockOpenModal }) => unknown) =>
    selector({ openModal: mockOpenModal }),
}))

vi.mock('sonner', () => ({
  toast: { error: mockToastError },
}))

vi.mock('@/lib/analytics', () => ({
  trackEvent: mockTrackEvent,
}))

globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome

function renderItem(onCreated = vi.fn()) {
  render(
    React.createElement(
      DropdownMenu,
      { open: true },
      React.createElement(DropdownMenuTrigger, null, 'trigger'),
      React.createElement(DropdownMenuContent, null, React.createElement(CreateGroupMenuItem, { onCreated }))
    )
  )
  return onCreated
}

function makeGroup(overrides: Partial<{ permanent: boolean }> = {}) {
  return { id: 'g', name: 'Group', color: 'rgba(0,0,0,1)', updatedAt: 0, windows: [], permanent: false, starred: false, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  entitlements = { maxGroups: 5 }
  mockUseGroupsData.mockReturnValue({ data: { available: [makeGroup({ permanent: true })], active: { id: '', index: 0 } } })
})

describe('CreateGroupMenuItem', () => {
  it('renders the separator and "Create new group…" item', () => {
    renderItem()
    expect(screen.getByText('Create new group…')).toBeInTheDocument()
  })

  it('opens the addGroup modal with onCreated in data when under the group limit', () => {
    const onCreated = renderItem()
    fireEvent.click(screen.getByText('Create new group…'))
    expect(mockOpenModal).toHaveBeenCalledWith('addGroup', { onCreated })
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('blocks and shows an upgrade toast when active (non-permanent) group count is at the free-tier limit', () => {
    entitlements = { maxGroups: 2 }
    mockUseGroupsData.mockReturnValue({
      data: {
        available: [makeGroup({ permanent: true }), makeGroup(), makeGroup()],
        active: { id: '', index: 0 },
      },
    })
    renderItem()
    fireEvent.click(screen.getByText('Create new group…'))
    expect(mockToastError).toHaveBeenCalledWith(
      'Free plan allows up to 2 groups.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Upgrade' }) })
    )
    expect(mockTrackEvent).toHaveBeenCalledWith('entitlement_limit_hit', { limit: 'maxGroups' })
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('does not count the permanent Now Open group toward the limit', () => {
    entitlements = { maxGroups: 1 }
    mockUseGroupsData.mockReturnValue({
      data: {
        available: [makeGroup({ permanent: true }), makeGroup({ permanent: true })],
        active: { id: '', index: 0 },
      },
    })
    const onCreated = renderItem()
    fireEvent.click(screen.getByText('Create new group…'))
    expect(mockOpenModal).toHaveBeenCalledWith('addGroup', { onCreated })
    expect(mockToastError).not.toHaveBeenCalled()
  })
})
