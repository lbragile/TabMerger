import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import React from 'react'
import { CleanupSuggestionBanner } from '@/components/CleanupSuggestionBanner'
import type { Tab } from '@/lib/types'

const { mockUseCleanupSuggestions, mockRemoveStaleTabs, mockSetActiveGroupIndex, mockToastSuccess, mockOpenModal, mockGetSetting } = vi.hoisted(() => ({
  mockUseCleanupSuggestions: vi.fn(),
  mockRemoveStaleTabs: vi.fn().mockResolvedValue(undefined),
  mockSetActiveGroupIndex: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockOpenModal: vi.fn(),
  mockGetSetting: vi.fn().mockResolvedValue({ confirmOnDelete: false }),
}))

vi.mock('@/hooks/useCleanupSuggestions', () => ({ useCleanupSuggestions: () => mockUseCleanupSuggestions() }))
vi.mock('@/hooks/useGroups', () => ({ useRemoveStaleTabs: () => ({ mutateAsync: mockRemoveStaleTabs }) }))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (sel: (s: object) => unknown) => sel({ setActiveGroupIndex: mockSetActiveGroupIndex, openModal: mockOpenModal }),
}))
vi.mock('@/lib/localDb', () => ({ getSetting: mockGetSetting }))
vi.mock('sonner', () => ({ toast: { success: mockToastSuccess, error: vi.fn() } }))

function makeTabs(n: number): Tab[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, title: `T${i}`, url: `https://a${i}.com` }))
}

describe('CleanupSuggestionBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockGetSetting.mockResolvedValue({ confirmOnDelete: false })
  })

  it('renders nothing when fewer than 5 stale tabs', () => {
    mockUseCleanupSuggestions.mockReturnValue({ staleTabs: makeTabs(4), staleGroupIndexes: [0], staleThresholdDays: 30, thresholdMs: 1 })
    const { container } = render(React.createElement(CleanupSuggestionBanner))
    expect(container.firstChild).toBeNull()
  })

  it('renders the banner with correct count and threshold when >= 5 stale tabs', () => {
    mockUseCleanupSuggestions.mockReturnValue({ staleTabs: makeTabs(7), staleGroupIndexes: [0, 1], staleThresholdDays: 30, thresholdMs: 1 })
    render(React.createElement(CleanupSuggestionBanner))
    expect(screen.getByText(/7 tabs were saved over 30 days ago/)).toBeTruthy()
  })

  it('review button opens the reviewStaleTabs modal with the stale tabs list', () => {
    const staleTabs = makeTabs(5)
    mockUseCleanupSuggestions.mockReturnValue({ staleTabs, staleGroupIndexes: [2, 3], staleThresholdDays: 30, thresholdMs: 1 })
    render(React.createElement(CleanupSuggestionBanner))
    fireEvent.click(screen.getByRole('button', { name: /review/i }))
    expect(mockOpenModal).toHaveBeenCalledWith('reviewStaleTabs', expect.objectContaining({ staleTabs }))
  })

  it('dismiss button hides the banner and persists dismissal', () => {
    mockUseCleanupSuggestions.mockReturnValue({ staleTabs: makeTabs(5), staleGroupIndexes: [0], staleThresholdDays: 30, thresholdMs: 1 })
    render(React.createElement(CleanupSuggestionBanner))
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByText(/tabs were saved over/)).toBeNull()
    expect(localStorage.getItem('cleanup_banner_dismissed_until')).toBeTruthy()
  })

  it('remove stale calls removeStaleTabs for each stale group index and shows success toast', async () => {
    mockUseCleanupSuggestions.mockReturnValue({ staleTabs: makeTabs(6), staleGroupIndexes: [1, 4], staleThresholdDays: 30, thresholdMs: 12345 })
    render(React.createElement(CleanupSuggestionBanner))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /remove stale/i }))
    })
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled())
    expect(mockRemoveStaleTabs).toHaveBeenCalledWith({ groupIndex: 1, staleThresholdMs: 12345 })
    expect(mockRemoveStaleTabs).toHaveBeenCalledWith({ groupIndex: 4, staleThresholdMs: 12345 })
    expect(mockToastSuccess).toHaveBeenCalledWith('Removed 6 stale tabs')
  })

  it('shows a confirmation modal instead of removing immediately when confirmOnDelete is true', async () => {
    mockGetSetting.mockResolvedValue({ confirmOnDelete: true })
    mockUseCleanupSuggestions.mockReturnValue({ staleTabs: makeTabs(6), staleGroupIndexes: [1, 4], staleThresholdDays: 30, thresholdMs: 12345 })
    render(React.createElement(CleanupSuggestionBanner))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /remove stale/i }))
    })
    await waitFor(() => expect(mockOpenModal).toHaveBeenCalledWith('removeStaleTabs', expect.objectContaining({ count: 6 })))
    expect(mockRemoveStaleTabs).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it('does not render when previously dismissed within the window', () => {
    localStorage.setItem('cleanup_banner_dismissed_until', String(Date.now() + 100000))
    mockUseCleanupSuggestions.mockReturnValue({ staleTabs: makeTabs(6), staleGroupIndexes: [0], staleThresholdDays: 30, thresholdMs: 1 })
    const { container } = render(React.createElement(CleanupSuggestionBanner))
    expect(container.firstChild).toBeNull()
  })
})
