import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useTabPreview } from '@/hooks/useTabPreview'

// ─── Mock useAI (useTabSummary) ───────────────────────────────────────────────

const mockFetchSummary = vi.fn().mockResolvedValue({ summary: 'A summary' })

vi.mock('@/hooks/useAI', () => ({
  useTabSummary: () => ({ mutateAsync: mockFetchSummary }),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return { wrapper }
}

/** Flush the 400ms debounce timer. */
async function triggerHover(handleMouseEnter: () => void) {
  handleMouseEnter()
  await act(async () => {
    vi.advanceTimersByTime(400)
    // Let all microtasks (Promises) settle
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── useTabPreview ────────────────────────────────────────────────────────────
// There is no content script in this extension — useTabPreview never fetches a
// live OG image. It only ever shows a `storedOgImage` already persisted on the tab.

describe('useTabPreview', () => {
  it('shows storedOgImage when provided (free user)', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useTabPreview('https://example.com', 'Example', false, 0, 'https://example.com/og.png'),
      { wrapper }
    )

    await triggerHover(result.current.handleMouseEnter)

    expect(result.current.ogImage).toBe('https://example.com/og.png')
  })

  it('shows storedOgImage for Pro AI users without auto-fetching a summary', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useTabPreview('https://example.com', 'Example', true, 0, 'https://example.com/og.png'),
      { wrapper }
    )

    await triggerHover(result.current.handleMouseEnter)

    expect(result.current.ogImage).toBe('https://example.com/og.png')
    // AI summary is NOT auto-fetched on hover — only via generateSummary()
    expect(mockFetchSummary).not.toHaveBeenCalled()
    expect(result.current.summary).toBeNull()
  })

  it('fetches AI summary only when generateSummary is called', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useTabPreview('https://example.com', 'Example', true, 0, 'https://example.com/og.png'),
      { wrapper }
    )

    await triggerHover(result.current.handleMouseEnter)
    expect(mockFetchSummary).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.generateSummary()
    })

    expect(mockFetchSummary).toHaveBeenCalledWith({ url: 'https://example.com', title: 'Example' })
    expect(result.current.summary).toBe('A summary')
  })

  it('shows no image when no storedOgImage is provided', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useTabPreview('https://example.com', 'Example', false, 0, undefined),
      { wrapper }
    )

    await triggerHover(result.current.handleMouseEnter)

    expect(result.current.ogImage).toBeNull()
  })

  it('shows no image for a live tab (tabId>0) with no storedOgImage', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useTabPreview('https://live.com', 'Live', false, 42, undefined),
      { wrapper }
    )

    await triggerHover(result.current.handleMouseEnter)

    expect(result.current.ogImage).toBeNull()
  })

  it('resets state on mouse leave', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useTabPreview('https://example.com', 'Example', false, 0, 'https://example.com/og.png'),
      { wrapper }
    )

    await triggerHover(result.current.handleMouseEnter)
    expect(result.current.visible).toBe(true)

    // handleMouseEnter starts a 500ms "grace" window (anti-flicker) during which
    // handleMouseLeave is a no-op — clear it before leaving, then wait out the
    // 300ms leave debounce.
    act(() => {
      vi.advanceTimersByTime(500)
    })
    act(() => {
      result.current.handleMouseLeave()
      vi.advanceTimersByTime(300)
    })
    expect(result.current.visible).toBe(false)
    expect(result.current.ogImage).toBeNull()
  })
})
