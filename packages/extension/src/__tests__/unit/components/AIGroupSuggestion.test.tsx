import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { AIGroupSuggestion } from '@/components/AIGroupSuggestion'
import type { GroupsState } from '@/lib/types'

const { mockSuggest, mockUseEntitlements, mockUseGroups, mockArchiveGroup, mockOpenModal, mockGetSetting } = vi.hoisted(() => ({
  mockSuggest: vi.fn().mockResolvedValue({ message: '', staleGroupIds: [] }),
  mockUseEntitlements: vi.fn(),
  mockUseGroups: vi.fn(),
  mockArchiveGroup: vi.fn().mockResolvedValue(undefined),
  mockOpenModal: vi.fn(),
  mockGetSetting: vi.fn().mockResolvedValue({ confirmOnDelete: false }),
}))

const MockQuotaExceededError = vi.hoisted(() => class extends Error {
  isQuotaExceeded = true as const
})

// This suite tests the suggestion banner's own behavior (dismiss/storage/quota), not
// the coming-soon flag, so force it on regardless of the real VITE_AI_ENABLED default.
vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: true }))
vi.mock('@/hooks/useAI', () => ({
  useSuggestSessions: () => ({ mutateAsync: mockSuggest }),
  QuotaExceededError: MockQuotaExceededError,
}))
vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => mockUseGroups(),
  useArchiveGroup: () => ({ mutateAsync: mockArchiveGroup }),
}))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/components/AIQuotaExceededPrompt', () => ({
  AIQuotaExceededPrompt: () => React.createElement('div', null, 'Buy more AI calls'),
}))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: { openModal: typeof mockOpenModal }) => unknown) => selector({ openModal: mockOpenModal }),
}))
vi.mock('@/lib/localDb', () => ({ getSetting: (...args: unknown[]) => mockGetSetting(...args) }))

function mockStorage(stored: unknown) {
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn((_key: string, cb: (result: Record<string, unknown>) => void) => {
          cb({ tm_ai_suggestion: stored })
        }),
        set: vi.fn(),
      },
    },
  } as unknown as typeof chrome
}

function makeGroup(id: string, name: string) {
  return { id, name, color: 'rgba(0,0,0,1)', updatedAt: Date.now(), windows: [] } as GroupsState['available'][number]
}

const twoGroups: GroupsState = {
  available: [makeGroup('g1', 'Shopping'), makeGroup('g2', 'Research')],
  active: { id: 'g1', index: 0 },
}

describe('AIGroupSuggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockArchiveGroup.mockResolvedValue(undefined)
    mockUseGroups.mockReturnValue({ data: twoGroups })
    mockGetSetting.mockResolvedValue({ confirmOnDelete: false })
  })

  it('renders nothing while entitlements are loading', () => {
    mockStorage(null)
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: true })
    const { container } = render(React.createElement(AIGroupSuggestion))
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when aiFeatures is disabled', async () => {
    mockStorage(null)
    mockUseEntitlements.mockReturnValue({ aiFeatures: false, loading: false })
    const { container } = render(React.createElement(AIGroupSuggestion))
    await waitFor(() => expect((globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>)).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
    expect(mockSuggest).not.toHaveBeenCalled()
  })

  it('shows the stored message and the Review/Archive banner CTAs', async () => {
    mockStorage({ message: 'You have 2 groups untouched for 2 weeks.', staleGroupIds: ['g1', 'g2'], dismissed: false })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    render(React.createElement(AIGroupSuggestion))
    expect(await screen.findByText('You have 2 groups untouched for 2 weeks.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy()
  })

  it('does not render when the stored suggestion was dismissed', async () => {
    mockStorage({ message: 'Old suggestion', staleGroupIds: ['g1'], dismissed: true })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    const { container } = render(React.createElement(AIGroupSuggestion))
    await waitFor(() => expect((globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>)).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('archiving a group via the Review modal callback removes it from the list and keeps the banner up', async () => {
    mockStorage({ message: 'You have 2 groups untouched for 2 weeks.', staleGroupIds: ['g1', 'g2'], dismissed: false })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    render(React.createElement(AIGroupSuggestion))
    await screen.findByText('You have 2 groups untouched for 2 weeks.')
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    const { onArchive } = mockOpenModal.mock.calls[0][1] as { onArchive: (groupId: string) => Promise<void> }
    await onArchive('g1')
    expect(mockArchiveGroup).toHaveBeenCalledWith(0)
    await waitFor(() => expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith({
      tm_ai_suggestion: { message: 'You have 2 groups untouched for 2 weeks.', staleGroupIds: ['g2'], dismissed: false },
    }))
  })

  it('archiving the last group via the Review modal callback dismisses the banner', async () => {
    mockStorage({ message: 'You have 1 group untouched for 2 weeks.', staleGroupIds: ['g1'], dismissed: false })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    render(React.createElement(AIGroupSuggestion))
    await screen.findByText('You have 1 group untouched for 2 weeks.')
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    const { onArchive } = mockOpenModal.mock.calls[0][1] as { onArchive: (groupId: string) => Promise<void> }
    await onArchive('g1')
    await waitFor(() => expect(screen.queryByText('You have 1 group untouched for 2 weeks.')).toBeNull())
    expect(globalThis.chrome.storage.local.set).toHaveBeenLastCalledWith({
      tm_ai_suggestion: { message: '', staleGroupIds: [], dismissed: true },
    })
  })

  it('clicking Review opens the reviewStaleGroup modal with all stale groups and an archive callback', async () => {
    mockStorage({ message: 'You have 2 groups untouched for 2 weeks.', staleGroupIds: ['g1', 'g2'], dismissed: false })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    render(React.createElement(AIGroupSuggestion))
    await screen.findByText('You have 2 groups untouched for 2 weeks.')
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(mockOpenModal).toHaveBeenCalledWith(
      'reviewStaleGroup',
      expect.objectContaining({
        groups: [expect.objectContaining({ id: 'g1' }), expect.objectContaining({ id: 'g2' })],
        onArchive: expect.any(Function),
      })
    )
  })

  it('banner-level Archive archives every listed stale group and dismisses the banner when confirmOnDelete is off', async () => {
    mockStorage({ message: 'You have 2 groups untouched for 2 weeks.', staleGroupIds: ['g1', 'g2'], dismissed: false })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    render(React.createElement(AIGroupSuggestion))
    await screen.findByText('You have 2 groups untouched for 2 weeks.')
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(mockArchiveGroup).toHaveBeenCalledWith(0))
    expect(mockArchiveGroup).toHaveBeenCalledWith(1)
    expect(mockOpenModal).not.toHaveBeenCalledWith('archiveStaleGroups', expect.anything())
    await waitFor(() => expect(screen.queryByText('You have 2 groups untouched for 2 weeks.')).toBeNull())
    expect(globalThis.chrome.storage.local.set).toHaveBeenLastCalledWith({
      tm_ai_suggestion: { message: '', staleGroupIds: [], dismissed: true },
    })
  })

  it('banner-level Archive opens the archiveStaleGroups confirm modal when confirmOnDelete is on', async () => {
    mockStorage({ message: 'You have 2 groups untouched for 2 weeks.', staleGroupIds: ['g1', 'g2'], dismissed: false })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    mockGetSetting.mockResolvedValue({ confirmOnDelete: true })
    render(React.createElement(AIGroupSuggestion))
    await screen.findByText('You have 2 groups untouched for 2 weeks.')
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await waitFor(() =>
      expect(mockOpenModal).toHaveBeenCalledWith('archiveStaleGroups', expect.objectContaining({ count: 2, onConfirm: expect.any(Function) }))
    )
    expect(mockArchiveGroup).not.toHaveBeenCalled()
    const { onConfirm } = mockOpenModal.mock.calls[0][1] as { onConfirm: () => Promise<void> }
    await onConfirm()
    expect(mockArchiveGroup).toHaveBeenCalledWith(0)
    expect(mockArchiveGroup).toHaveBeenCalledWith(1)
  })

  it('shows both Review and Archive banner CTAs even when only one stale group is listed', async () => {
    mockStorage({ message: 'You have 1 group untouched for 2 weeks.', staleGroupIds: ['g1'], dismissed: false })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    render(React.createElement(AIGroupSuggestion))
    await screen.findByText('You have 1 group untouched for 2 weeks.')
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy()
  })

  it('skips a stale group id that no longer resolves to a group', async () => {
    mockStorage({ message: 'You have 2 groups untouched for 2 weeks.', staleGroupIds: ['g1', 'deleted-id'], dismissed: false })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    render(React.createElement(AIGroupSuggestion))
    await screen.findByText('You have 2 groups untouched for 2 weeks.')
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy()
  })

  it('auto-dismisses when every stale group id is unresolvable', async () => {
    mockStorage({ message: 'You have 1 group untouched for 2 weeks.', staleGroupIds: ['deleted-id'], dismissed: false })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    const { container } = render(React.createElement(AIGroupSuggestion))
    await waitFor(() => expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith({
      tm_ai_suggestion: { message: '', staleGroupIds: [], dismissed: true },
    }))
    expect(container.firstChild).toBeNull()
  })

  it('dismiss button hides the banner and persists dismissed state', async () => {
    mockStorage({ message: 'You have 1 group untouched for 2 weeks.', staleGroupIds: ['g1'], dismissed: false })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    render(React.createElement(AIGroupSuggestion))
    await screen.findByText('You have 1 group untouched for 2 weeks.')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByText('You have 1 group untouched for 2 weeks.')).toBeNull())
    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith({
      tm_ai_suggestion: { message: '', staleGroupIds: [], dismissed: true },
    })
  })

  it('shows the buy-more-AI-calls CTA instead of silently failing when the background suggest fetch is quota-exceeded', async () => {
    mockStorage(null)
    mockSuggest.mockRejectedValue(new MockQuotaExceededError('quota exceeded'))
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    render(React.createElement(AIGroupSuggestion))
    await waitFor(() => expect(mockSuggest).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Buy more AI calls')).toBeTruthy()
  })

  it('does not show the quota CTA when the background suggest fetch fails for a non-quota reason', async () => {
    mockStorage(null)
    mockSuggest.mockRejectedValue(new Error('network error'))
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    const { container } = render(React.createElement(AIGroupSuggestion))
    await waitFor(() => expect(mockSuggest).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Buy more AI calls')).toBeNull()
    expect(container.firstChild).toBeNull()
  })

  it('fetches a suggestion once when no stored suggestion exists yet', async () => {
    mockStorage(null)
    mockSuggest.mockResolvedValue({ message: 'New AI idea', staleGroupIds: ['g1'] })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    render(React.createElement(AIGroupSuggestion))
    await waitFor(() => expect(mockSuggest).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('New AI idea')).toBeTruthy()
  })
})
