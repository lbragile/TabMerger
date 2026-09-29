import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useUrlRules, useSaveUrlRules, matchUrlToRule } from '@/hooks/useUrlRules'
import type { UrlRule } from '@/lib/types'

const { mockGetSetting, mockSetSetting } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockSetSetting: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/localDb', () => ({ getSetting: mockGetSetting, setSetting: mockSetSetting }))

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return { qc, wrapper: ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children) }
}

describe('useUrlRules query', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads rules from settings, defaulting to []', async () => {
    mockGetSetting.mockResolvedValue([])
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUrlRules(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
  })
})

describe('useSaveUrlRules', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists the whole array in one write and updates the query cache', async () => {
    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useSaveUrlRules(), { wrapper })
    const rules: UrlRule[] = [
      { id: 'r1', pattern: 'a.com', groupId: 'g1', createdAt: 1 },
      { id: 'r2', pattern: 'b.com', groupId: 'g2', createdAt: 2 },
    ]
    await act(async () => {
      await result.current.mutateAsync(rules)
    })
    expect(mockSetSetting).toHaveBeenCalledTimes(1)
    expect(mockSetSetting).toHaveBeenCalledWith('urlRules', rules)
    expect(qc.getQueryData(['urlRules'])).toEqual(rules)
  })

  it('persists an empty array when all rules were deleted from the draft', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSaveUrlRules(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync([])
    })
    expect(mockSetSetting).toHaveBeenCalledWith('urlRules', [])
  })

  it('rejects growth past maxUrlRules and writes nothing', async () => {
    mockGetSetting.mockResolvedValue([{ id: 'r1', pattern: 'a.com', groupId: 'g1', createdAt: 1 }])
    const { qc, wrapper } = makeWrapper()
    // seed the query cache the same way the real app does — useUrlRules() populates it before Save runs
    qc.setQueryData(['urlRules'], [{ id: 'r1', pattern: 'a.com', groupId: 'g1', createdAt: 1 }])
    const { result } = renderHook(() => useSaveUrlRules(1), { wrapper })
    const grown: UrlRule[] = [
      { id: 'r1', pattern: 'a.com', groupId: 'g1', createdAt: 1 },
      { id: 'r2', pattern: 'b.com', groupId: 'g2', createdAt: 2 },
    ]
    await act(async () => {
      await expect(result.current.mutateAsync(grown)).rejects.toThrow()
    })
    expect(mockSetSetting).not.toHaveBeenCalled()
  })

  it('allows reordering or deleting rules even while already over the limit (post-downgrade)', async () => {
    const existing: UrlRule[] = [
      { id: 'r1', pattern: 'a.com', groupId: 'g1', createdAt: 1 },
      { id: 'r2', pattern: 'b.com', groupId: 'g2', createdAt: 2 },
      { id: 'r3', pattern: 'c.com', groupId: 'g3', createdAt: 3 },
    ]
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(['urlRules'], existing)
    const { result } = renderHook(() => useSaveUrlRules(1), { wrapper }) // maxUrlRules=1, already over with 3 saved
    const reordered = [existing[1], existing[0], existing[2]] // same length — reorder
    await act(async () => {
      await result.current.mutateAsync(reordered)
    })
    expect(mockSetSetting).toHaveBeenCalledWith('urlRules', reordered)

    vi.clearAllMocks()
    qc.setQueryData(['urlRules'], reordered)
    const fewer = reordered.slice(0, 1) // delete — fewer than before
    await act(async () => {
      await result.current.mutateAsync(fewer)
    })
    expect(mockSetSetting).toHaveBeenCalledWith('urlRules', fewer)
  })

  it('does not gate when maxUrlRules is omitted (defaults to unlimited)', async () => {
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(['urlRules'], [])
    const { result } = renderHook(() => useSaveUrlRules(), { wrapper })
    const many: UrlRule[] = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, pattern: `${i}.com`, groupId: 'g', createdAt: i }))
    await act(async () => {
      await result.current.mutateAsync(many)
    })
    expect(mockSetSetting).toHaveBeenCalledWith('urlRules', many)
  })
})

describe('matchUrlToRule', () => {
  it('returns null when no rules match', () => {
    expect(matchUrlToRule('https://example.com', [])).toBeNull()
  })

  it('matches a wildcard pattern and returns the groupId', () => {
    const rules: UrlRule[] = [{ id: 'r1', pattern: 'github.com/*', groupId: 'g1', createdAt: 1 }]
    expect(matchUrlToRule('https://github.com/lbragile/TabMerger', rules)).toBe('g1')
  })

  it('strips the scheme before matching', () => {
    const rules: UrlRule[] = [{ id: 'r1', pattern: 'example.com/path', groupId: 'g1', createdAt: 1 }]
    expect(matchUrlToRule('http://example.com/path', rules)).toBe('g1')
  })

  it('returns the first matching rule in order', () => {
    const rules: UrlRule[] = [
      { id: 'r1', pattern: 'a.com/*', groupId: 'first', createdAt: 1 },
      { id: 'r2', pattern: 'a.com/*', groupId: 'second', createdAt: 2 },
    ]
    expect(matchUrlToRule('https://a.com/x', rules)).toBe('first')
  })

  it('does not match unrelated urls', () => {
    const rules: UrlRule[] = [{ id: 'r1', pattern: 'github.com/*', groupId: 'g1', createdAt: 1 }]
    expect(matchUrlToRule('https://gitlab.com/x', rules)).toBeNull()
  })

  it('skips malformed patterns without throwing', () => {
    const rules: UrlRule[] = [{ id: 'r1', pattern: '[unclosed', groupId: 'g1', createdAt: 1 }]
    expect(() => matchUrlToRule('https://a.com', rules)).not.toThrow()
    expect(matchUrlToRule('https://a.com', rules)).toBeNull()
  })
})
