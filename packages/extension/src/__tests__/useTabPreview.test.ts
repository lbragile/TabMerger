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

// ─── Chrome API mock ──────────────────────────────────────────────────────────

const sendMessageMock = vi.fn()
const queryMock = vi.fn()
globalThis.chrome = {
  tabs: { sendMessage: sendMessageMock, query: queryMock },
} as unknown as typeof chrome

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
  sendMessageMock.mockResolvedValue({})
  queryMock.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── useTabPreview ────────────────────────────────────────────────────────────

describe('useTabPreview', () => {
  it('uses storedOgImage directly and skips sendMessage (free user)', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useTabPreview('https://example.com', 'Example', false, 0, 'https://example.com/og.png'),
      { wrapper }
    )

    await triggerHover(result.current.handleMouseEnter)

    expect(result.current.ogImage).toBe('https://example.com/og.png')
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('uses storedOgImage and skips sendMessage for Pro AI users (no extra OG fetch)', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useTabPreview('https://example.com', 'Example', true, 0, 'https://example.com/og.png'),
      { wrapper }
    )

    await triggerHover(result.current.handleMouseEnter)

    expect(result.current.ogImage).toBe('https://example.com/og.png')
    expect(sendMessageMock).not.toHaveBeenCalled()
    // AI summary still fetched for Pro AI users
    expect(mockFetchSummary).toHaveBeenCalledWith({ url: 'https://example.com', title: 'Example' })
  })

  it('falls back to sendMessage when storedOgImage is absent (free user, tabId=0)', async () => {
    // tabId=0 means saved tab with no stored ogImage — fetchOgImage returns null (tabId falsy)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useTabPreview('https://example.com', 'Example', false, 0, undefined),
      { wrapper }
    )

    await triggerHover(result.current.handleMouseEnter)

    // sendMessage is not called because tabId is 0 (falsy guard inside fetchOgImage)
    expect(sendMessageMock).not.toHaveBeenCalled()
    expect(result.current.ogImage).toBeNull()
  })

  it('calls sendMessage for live tab when no storedOgImage (free user, tabId>0)', async () => {
    sendMessageMock.mockResolvedValue({ ogImage: 'https://live.com/og.png' })

    const { wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useTabPreview('https://live.com', 'Live', false, 42, undefined),
      { wrapper }
    )

    await triggerHover(result.current.handleMouseEnter)

    expect(sendMessageMock).toHaveBeenCalledWith(42, { type: 'GET_PAGE_META' })
    expect(result.current.ogImage).toBe('https://live.com/og.png')
  })

  it('looks up live tab by URL for saved tabs (tabId=0, no storedOgImage)', async () => {
    queryMock.mockResolvedValue([{ id: 99 }])
    sendMessageMock.mockResolvedValue({ ogImage: 'https://saved.com/og.png' })

    const { wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useTabPreview('https://saved.com/page', 'Saved', false, 0, undefined),
      { wrapper }
    )

    await triggerHover(result.current.handleMouseEnter)

    expect(queryMock).toHaveBeenCalledWith({ url: 'https://saved.com/page' })
    expect(sendMessageMock).toHaveBeenCalledWith(99, { type: 'GET_PAGE_META' })
    expect(result.current.ogImage).toBe('https://saved.com/og.png')
  })

  it('shows no image when saved tab URL is not open in Chrome', async () => {
    queryMock.mockResolvedValue([]) // no live tab found

    const { wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useTabPreview('https://closed.com/page', 'Closed', false, 0, undefined),
      { wrapper }
    )

    await triggerHover(result.current.handleMouseEnter)

    expect(result.current.ogImage).toBeNull()
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('resets state on mouse leave', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useTabPreview('https://example.com', 'Example', false, 0, 'https://example.com/og.png'),
      { wrapper }
    )

    await triggerHover(result.current.handleMouseEnter)
    expect(result.current.visible).toBe(true)

    act(() => {
      result.current.handleMouseLeave()
      vi.advanceTimersByTime(100)
    })
    expect(result.current.visible).toBe(false)
    expect(result.current.ogImage).toBeNull()
  })
})
