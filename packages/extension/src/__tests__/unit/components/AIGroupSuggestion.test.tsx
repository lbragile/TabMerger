import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { AIGroupSuggestion } from '@/components/AIGroupSuggestion'
import type { GroupsState } from '@/lib/types'

const { mockSuggest, mockUseEntitlements, mockUseGroups } = vi.hoisted(() => ({
  mockSuggest: vi.fn().mockResolvedValue({ suggestion: '' }),
  mockUseEntitlements: vi.fn(),
  mockUseGroups: vi.fn(),
}))

vi.mock('@/hooks/useAI', () => ({ useSuggestSessions: () => ({ mutateAsync: mockSuggest }) }))
vi.mock('@/hooks/useGroups', () => ({ useGroups: () => mockUseGroups() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))

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

const groupsState: GroupsState = { available: [], active: { id: '', index: 0 } }

describe('AIGroupSuggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGroups.mockReturnValue({ data: groupsState })
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

  it('shows the stored suggestion text and dismiss button', async () => {
    mockStorage({ suggestion: 'Group your shopping tabs', dismissed: false })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    render(React.createElement(AIGroupSuggestion))
    expect(await screen.findByText('Group your shopping tabs')).toBeTruthy()
  })

  it('does not render when the stored suggestion was dismissed', async () => {
    mockStorage({ suggestion: 'Old suggestion', dismissed: true })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    const { container } = render(React.createElement(AIGroupSuggestion))
    await waitFor(() => expect((globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>)).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('dismiss button hides the banner and persists dismissed state', async () => {
    mockStorage({ suggestion: 'Group your shopping tabs', dismissed: false })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    render(React.createElement(AIGroupSuggestion))
    await screen.findByText('Group your shopping tabs')
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.queryByText('Group your shopping tabs')).toBeNull())
    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith({
      tm_ai_suggestion: { suggestion: 'Group your shopping tabs', dismissed: true },
    })
  })

  it('fetches a suggestion once when no stored suggestion exists yet', async () => {
    mockStorage(null)
    mockSuggest.mockResolvedValue({ suggestion: 'New AI idea' })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, loading: false })
    render(React.createElement(AIGroupSuggestion))
    await waitFor(() => expect(mockSuggest).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('New AI idea')).toBeTruthy()
  })
})
