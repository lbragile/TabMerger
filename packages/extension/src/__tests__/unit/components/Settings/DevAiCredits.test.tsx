import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEV_CREDITS_USED_MAX, DevAiCredits, parseDevCreditsUsed } from '@/components/Settings/DevAiCredits'
import { t } from '@/lib/i18n'

const { mockAiPost, mockToast, mockAuth } = vi.hoisted(() => ({
  mockAiPost: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn() },
  mockAuth: vi.fn()
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockAuth() }))
vi.mock('@/hooks/useAI', () => ({ aiPost: mockAiPost }))
vi.mock('@/lib/toast', () => ({ toast: mockToast }))

function renderControl(cap = 2000) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(DevAiCredits, { cap })))
  return invalidate
}

const input = () => screen.getByLabelText(t('settings.dev.usageLabel'))
const setButton = () => screen.getByRole('button', { name: t('settings.dev.usageSet') })
const resetButton = () => screen.getByRole('button', { name: t('settings.dev.usageReset') })

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockReturnValue({ user: { id: 'u1' }, session: { access_token: 'tok' } })
  mockAiPost.mockResolvedValue({ count: 0 })
})

describe('parseDevCreditsUsed', () => {
  it.each([
    ['95', 95],
    ['', 0],
    ['abc', 0],
    ['-5', 0],
    ['12.9', 12],
    ['1e9', DEV_CREDITS_USED_MAX],
    ['Infinity', 0]
  ])('%j -> %d', (raw, expected) => {
    expect(parseDevCreditsUsed(raw)).toBe(expected)
  })
})

describe('DevAiCredits', () => {
  it('labels the field "Credits used this month" and shows the allowance', () => {
    renderControl(2100)
    expect(input()).toHaveValue(0)
    expect(screen.getByText(t('settings.dev.usageDescription', { cap: 2100 }))).toBeInTheDocument()
  })

  it('Set posts the entered credits to /api/ai/dev-usage, then refreshes the credits meter', async () => {
    const invalidate = renderControl()
    fireEvent.change(input(), { target: { value: '1999' } })
    fireEvent.click(setButton())

    await waitFor(() => expect(mockAiPost).toHaveBeenCalledWith('/api/ai/dev-usage', { count: 1999 }, 'tok'))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['aiUsage'] }))
    expect(mockToast.success).toHaveBeenCalledWith(t('settings.toast.aiUsageSet', { credits: 1999 }))
    expect(mockToast.success.mock.calls[0][0]).toContain('1999')
  })

  it('Set sends a whole, non-negative number of credits', async () => {
    renderControl()
    fireEvent.change(input(), { target: { value: '-3' } })
    fireEvent.click(setButton())
    await waitFor(() => expect(mockAiPost).toHaveBeenCalledWith('/api/ai/dev-usage', { count: 0 }, 'tok'))
  })

  it('Reset posts 0 credits', async () => {
    renderControl()
    fireEvent.change(input(), { target: { value: '50' } })
    fireEvent.click(resetButton())
    await waitFor(() => expect(mockAiPost).toHaveBeenCalledWith('/api/ai/dev-usage', { count: 0 }, 'tok'))
  })

  it('shows an error and leaves the meter alone when the server refuses', async () => {
    mockAiPost.mockRejectedValue(new Error('500'))
    const invalidate = renderControl()
    fireEvent.click(resetButton())
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(t('settings.toast.aiUsageFailed')))
    expect(invalidate).not.toHaveBeenCalled()
    expect(mockToast.success).not.toHaveBeenCalled()
  })

  it('asks to sign in, without a request, when signed out', async () => {
    mockAuth.mockReturnValue({ user: null, session: null })
    const invalidate = renderControl()
    fireEvent.click(setButton())
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(t('settings.toast.signInForAiUsage')))
    expect(mockAiPost).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })
})
