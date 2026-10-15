/**
 * Automatic backups live in the sessions store but must never appear in the sidebar's Sessions
 * list, its count, or the Free session limit (Restore there closes every window).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SidePanel } from '@/components/SidePanel'
import type { Group, GroupsState } from '@/lib/types'
import type { Session } from '@tabmerger/shared'

const h = vi.hoisted(() => ({
  sessions: [] as unknown[],
  saveSession: vi.fn(),
  openModal: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  closestCenter: vi.fn(),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
}))
vi.mock('@/hooks/useDnd', () => ({
  useDndSensors: () => [],
  useGroupDndHandlers: () => ({ onDragEnd: vi.fn() }),
  setBodyDragCursor: vi.fn(),
}))
vi.mock('@/components/SidePanel/GroupItem', () => ({ GroupItem: () => null }))
vi.mock('@/hooks/useGroups', () => ({
  useAddGroup: () => ({ mutateAsync: vi.fn() }),
  useRestoreGroup: () => ({ mutate: vi.fn() }),
  useDeleteGroup: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({ maxGroups: 5, maxTabs: 50, tier: 'free', sessions: false, cloudSync: false }),
  isOverFreeLimit: (i: number, l: number) => i >= l,
}))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (sel: (s: object) => unknown) =>
    sel({ selectionMode: false, activeGroupIndex: 0, setActiveGroupIndex: vi.fn(), setRenameTarget: vi.fn(), openModal: h.openModal }),
}))
vi.mock('@/hooks/useSessions', () => ({
  useSessions: () => ({ data: h.sessions }),
  useDeleteSession: () => ({ mutate: vi.fn() }),
  useRestoreSession: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveSession: () => ({ mutateAsync: h.saveSession }),
}))
vi.mock('@/lib/toast', () => ({ toast: { error: h.toastError, success: vi.fn() } }))
globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome

const group = (o: Partial<Group> = {}): Group => ({ id: 'g', name: 'Group', color: 'c', updatedAt: 1, windows: [], ...o })
const state: GroupsState = { available: [group({ permanent: true })], active: { id: '', index: 0 } }
const session = (id: string, name: string, auto?: boolean): Session =>
  ({ id, name, createdAt: Date.now(), groups: [group()], ...(auto === undefined ? {} : { auto }) }) as Session

function wrap() {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <SidePanel groupsState={state} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sessions = []
})

describe('SidePanel — automatic backups are not sessions', () => {
  it('leaves automatic backups out of the list and the count, keeps manual sessions', async () => {
    h.sessions = [session('a1', 'Automatic backup · Oct 11', true), session('a2', 'Automatic backup · Oct 10', true), session('m1', 'Morning setup'), session('m2', 'Explicit false', false)]
    const user = userEvent.setup()
    wrap()
    expect(screen.getByText(/SESSIONS \(2\)/)).toBeTruthy()
    await user.click(screen.getByText(/SESSIONS \(2\)/))
    expect(screen.getByText('Morning setup')).toBeTruthy()
    expect(screen.getByText('Explicit false')).toBeTruthy()
    expect(screen.queryByText(/Automatic backup/)).toBeNull()
  })

  it('only the literal true hides a session', async () => {
    h.sessions = [session('x', 'Truthy string', 'true' as unknown as boolean), session('y', 'One', 1 as unknown as boolean)]
    const user = userEvent.setup()
    wrap()
    await user.click(screen.getByText(/SESSIONS \(2\)/))
    expect(screen.getByText('Truthy string')).toBeTruthy()
    expect(screen.getByText('One')).toBeTruthy()
  })

  it('only automatic backups: the section is empty', async () => {
    h.sessions = [session('a1', 'Automatic backup · x', true)]
    const user = userEvent.setup()
    wrap()
    await user.click(screen.getByText(/SESSIONS \(0\)/))
    expect(screen.getByText('No saved sessions')).toBeTruthy()
  })

  it('automatic backups do not count toward the Free session limit when saving a session', async () => {
    h.sessions = [...Array.from({ length: 10 }, (_, i) => session(`a${i}`, `auto ${i}`, true)), session('m', 'manual')]
    h.saveSession.mockResolvedValue(undefined)
    wrap()
    await userEvent.setup().click(screen.getByRole('button', { name: /save current session/i }))
    const { onSave } = h.openModal.mock.calls[0][1] as { onSave: (n: string) => Promise<void> }
    await onSave('New')
    expect(h.saveSession).toHaveBeenCalledWith(expect.objectContaining({ name: 'New', sessionCount: 1 }))
  })
})
