import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockUseEntitlements, mockUseGroups } = vi.hoisted(() => {
  const mockUseEntitlements = vi.fn()
  const mockUseGroups = vi.fn()
  return { mockUseEntitlements, mockUseGroups }
})

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: mockUseEntitlements,
  isApproachingLimit: (g: number, t: number, mg: number, mt: number) =>
    g >= mg - 1 || t >= mt - 5,
}))

vi.mock('@/hooks/useGroups', () => ({
  useGroups: mockUseGroups,
}))

// chrome.tabs.create stub
const mockTabsCreate = vi.fn()
globalThis.chrome = { tabs: { create: mockTabsCreate } } as unknown as typeof chrome

// ─── Helpers ──────────────────────────────────────────────────────────────────

function freeEntitlements(overrides: Partial<ReturnType<typeof mockUseEntitlements>> = {}) {
  return {
    tier: 'free',
    maxGroups: 5,
    maxTabs: 50,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    subscriptionStatus: null,
    loading: false,
    ...overrides,
  }
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(React.createElement(QueryClientProvider, { client: qc }, ui))
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  mockTabsCreate.mockResolvedValue(undefined)
})

// ─── SubscriptionStatusBanner ─────────────────────────────────────────────────

describe('SubscriptionStatusBanner — PAY-001', () => {
  async function renderBanner() {
    const { SubscriptionStatusBanner } = await import('@/components/SubscriptionStatusBanner')
    return wrap(React.createElement(SubscriptionStatusBanner))
  }

  it('renders null when no issues (active subscription, no cancel)', async () => {
    mockUseEntitlements.mockReturnValue(freeEntitlements({
      tier: 'pro',
      subscriptionStatus: 'active',
      cancelAtPeriodEnd: false,
    }))
    const { container } = await renderBanner()
    expect(container.firstChild).toBeNull()
  })

  it('renders amber banner with formatted date when cancelAtPeriodEnd=true', async () => {
    mockUseEntitlements.mockReturnValue(freeEntitlements({
      tier: 'pro',
      subscriptionStatus: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-08-01T00:00:00Z',
    }))
    await renderBanner()
    // Date renders as formatted locale string — just verify the year and month are present
    expect(screen.getByText(/2026/)).toBeInTheDocument()
    expect(screen.getByText(/Pro plan ends on/)).toBeInTheDocument()
  })

  it('renders red banner with update-card link when subscriptionStatus=past_due', async () => {
    mockUseEntitlements.mockReturnValue(freeEntitlements({
      tier: 'pro',
      subscriptionStatus: 'past_due',
    }))
    await renderBanner()
    expect(screen.getByText(/Payment issue/)).toBeInTheDocument()
    expect(screen.getByText(/update your card/i)).toBeInTheDocument()
  })

  it('red (past_due) takes priority over amber (cancelAtPeriodEnd)', async () => {
    mockUseEntitlements.mockReturnValue(freeEntitlements({
      tier: 'pro',
      subscriptionStatus: 'past_due',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-08-01T00:00:00Z',
    }))
    await renderBanner()
    // Red banner shown, amber text absent
    expect(screen.getByText(/Payment issue/)).toBeInTheDocument()
    expect(screen.queryByText(/Pro plan ends on/)).toBeNull()
  })

  it('clicking update-card link opens account page', async () => {
    const user = userEvent.setup()
    mockUseEntitlements.mockReturnValue(freeEntitlements({
      tier: 'pro',
      subscriptionStatus: 'past_due',
    }))
    await renderBanner()
    await user.click(screen.getByText(/update your card/i))
    expect(mockTabsCreate).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/account') }))
  })
})

// ─── UpgradeCTA ───────────────────────────────────────────────────────────────

describe('UpgradeCTA — PAY-001', () => {
  // 4 saved groups (index 1-4 after Now Open) — approaching limit of 5
  const approachingGroupsState = {
    data: {
      available: [
        { id: 'g0', permanent: true, windows: [] },
        { id: 'g1', windows: [{ tabs: [] }] },
        { id: 'g2', windows: [{ tabs: [] }] },
        { id: 'g3', windows: [{ tabs: [] }] },
        { id: 'g4', windows: [{ tabs: [] }] },
      ],
      active: { id: 'g0', index: 0 },
    },
  }

  const safeGroupsState = {
    data: {
      available: [
        { id: 'g0', permanent: true, windows: [] },
        { id: 'g1', windows: [{ tabs: [] }] },
      ],
      active: { id: 'g0', index: 0 },
    },
  }

  async function renderCTA() {
    const { UpgradeCTA } = await import('@/components/UpgradeCTA')
    return wrap(React.createElement(UpgradeCTA))
  }

  it('renders when approaching group limit (free tier, 4 groups)', async () => {
    mockUseEntitlements.mockReturnValue(freeEntitlements())
    mockUseGroups.mockReturnValue(approachingGroupsState)
    await renderCTA()
    expect(screen.getByText(/approaching the free limit/)).toBeInTheDocument()
  })

  it('does not render for pro users', async () => {
    mockUseEntitlements.mockReturnValue(freeEntitlements({ tier: 'pro', maxGroups: Infinity, maxTabs: Infinity }))
    mockUseGroups.mockReturnValue(approachingGroupsState)
    const { container } = await renderCTA()
    expect(container.firstChild).toBeNull()
  })

  it('does not render when subscriptionStatus is not null (e.g. past_due)', async () => {
    mockUseEntitlements.mockReturnValue(freeEntitlements({ subscriptionStatus: 'past_due' }))
    mockUseGroups.mockReturnValue(approachingGroupsState)
    const { container } = await renderCTA()
    expect(container.firstChild).toBeNull()
  })

  it('does not render when well within limits', async () => {
    mockUseEntitlements.mockReturnValue(freeEntitlements())
    mockUseGroups.mockReturnValue(safeGroupsState)
    const { container } = await renderCTA()
    expect(container.firstChild).toBeNull()
  })

  it('dismiss button sets sessionStorage and hides banner', async () => {
    const user = userEvent.setup()
    mockUseEntitlements.mockReturnValue(freeEntitlements())
    mockUseGroups.mockReturnValue(approachingGroupsState)
    await renderCTA()
    expect(screen.getByText(/approaching the free limit/)).toBeInTheDocument()

    const dismissBtn = screen.getByRole('button', { name: /dismiss/i })
    await user.click(dismissBtn)

    expect(screen.queryByText(/approaching the free limit/)).toBeNull()
    expect(sessionStorage.getItem('upgrade_cta_dismissed')).toBe('1')
  })

  it('upgrade button opens pricing page', async () => {
    const user = userEvent.setup()
    mockUseEntitlements.mockReturnValue(freeEntitlements())
    mockUseGroups.mockReturnValue(approachingGroupsState)
    await renderCTA()
    await user.click(screen.getByRole('button', { name: /upgrade/i }))
    expect(mockTabsCreate).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/pricing') }))
  })

  it('does not render if already dismissed in sessionStorage', async () => {
    sessionStorage.setItem('upgrade_cta_dismissed', '1')
    mockUseEntitlements.mockReturnValue(freeEntitlements())
    mockUseGroups.mockReturnValue(approachingGroupsState)
    const { container } = await renderCTA()
    expect(container.firstChild).toBeNull()
  })
})
