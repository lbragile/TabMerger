import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useCleanupSuggestions } from '@/hooks/useCleanupSuggestions'
import { createGroup, createNowOpenGroup, createWindow, createTab } from '@/lib/utils'
import type { GroupsState } from '@/lib/types'

const { mockGetSetting, mockUseGroups } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockUseGroups: vi.fn(),
}))

vi.mock('@/lib/localDb', () => ({ getSetting: mockGetSetting }))
vi.mock('@/hooks/useGroups', () => ({ useGroups: () => mockUseGroups() }))

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

const DAY = 24 * 60 * 60 * 1000

describe('useCleanupSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSetting.mockResolvedValue({})
  })

  it('returns empty when groupsState is undefined', () => {
    mockUseGroups.mockReturnValue({ data: undefined })
    const { result } = renderHook(() => useCleanupSuggestions(), { wrapper })
    expect(result.current.staleTabs).toEqual([])
    expect(result.current.staleGroupIndexes).toEqual([])
  })

  it('excludes Now Open (permanent) group tabs from staleness check', async () => {
    const now = Date.now()
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [createWindow([{ ...createTab('A', 'https://a.com'), savedAt: now - 40 * DAY }])]
    const groupsState: GroupsState = { available: [nowOpen], active: { id: nowOpen.id, index: 0 } }
    mockUseGroups.mockReturnValue({ data: groupsState })
    const { result } = renderHook(() => useCleanupSuggestions(), { wrapper })
    await waitFor(() => expect(result.current.staleThresholdDays).toBe(30))
    expect(result.current.staleTabs).toEqual([])
  })

  it('does not surface suggestions below the MIN_STALE threshold (5 tabs)', async () => {
    const now = Date.now()
    const staleTabs = Array.from({ length: 4 }, (_, i) => ({ ...createTab(`T${i}`, `https://a${i}.com`), savedAt: now - 40 * DAY }))
    const group = createGroup(undefined, 'Saved')
    group.windows = [createWindow(staleTabs)]
    const groupsState: GroupsState = { available: [group], active: { id: group.id, index: 0 } }
    mockUseGroups.mockReturnValue({ data: groupsState })
    const { result } = renderHook(() => useCleanupSuggestions(), { wrapper })
    await waitFor(() => expect(result.current.staleThresholdDays).toBe(30))
    expect(result.current.staleTabs).toEqual([])
    expect(result.current.staleGroupIndexes).toEqual([])
  })

  it('surfaces stale tabs and their group indexes when >= MIN_STALE stale tabs exist', async () => {
    const now = Date.now()
    const staleTabs = Array.from({ length: 5 }, (_, i) => ({ ...createTab(`T${i}`, `https://a${i}.com`), savedAt: now - 40 * DAY }))
    const group = createGroup(undefined, 'Saved')
    group.windows = [createWindow(staleTabs)]
    const groupsState: GroupsState = { available: [group], active: { id: group.id, index: 0 } }
    mockUseGroups.mockReturnValue({ data: groupsState })
    const { result } = renderHook(() => useCleanupSuggestions(), { wrapper })
    await waitFor(() => expect(result.current.staleThresholdDays).toBe(30))
    expect(result.current.staleTabs.length).toBe(5)
    expect(result.current.staleGroupIndexes).toEqual([0])
  })

  it('respects custom staleThresholdDays setting', async () => {
    mockGetSetting.mockResolvedValue({ staleThresholdDays: 7 })
    const now = Date.now()
    const staleTabs = Array.from({ length: 5 }, (_, i) => ({ ...createTab(`T${i}`, `https://a${i}.com`), savedAt: now - 10 * DAY }))
    const group = createGroup(undefined, 'Saved')
    group.windows = [createWindow(staleTabs)]
    const groupsState: GroupsState = { available: [group], active: { id: group.id, index: 0 } }
    mockUseGroups.mockReturnValue({ data: groupsState })
    const { result } = renderHook(() => useCleanupSuggestions(), { wrapper })
    await waitFor(() => expect(result.current.staleThresholdDays).toBe(7))
    expect(result.current.staleTabs.length).toBe(5)
  })

  it('does not count tabs without savedAt as stale', async () => {
    const tabs = Array.from({ length: 6 }, (_, i) => createTab(`T${i}`, `https://a${i}.com`))
    const group = createGroup(undefined, 'Saved')
    group.windows = [createWindow(tabs)]
    const groupsState: GroupsState = { available: [group], active: { id: group.id, index: 0 } }
    mockUseGroups.mockReturnValue({ data: groupsState })
    const { result } = renderHook(() => useCleanupSuggestions(), { wrapper })
    await waitFor(() => expect(result.current.staleThresholdDays).toBe(30))
    expect(result.current.staleTabs).toEqual([])
  })
})
