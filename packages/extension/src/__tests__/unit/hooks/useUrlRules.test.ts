import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  useUrlRules,
  useAddUrlRule,
  useDeleteUrlRule,
  useReorderUrlRule,
  matchUrlToRule,
} from '@/hooks/useUrlRules'
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

describe('useAddUrlRule', () => {
  beforeEach(() => vi.clearAllMocks())

  it('appends a new rule and persists it', async () => {
    mockGetSetting.mockResolvedValue([])
    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useAddUrlRule(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ pattern: 'github.com/*', groupId: 'g1' })
    })
    expect(mockSetSetting).toHaveBeenCalledWith('urlRules', [
      expect.objectContaining({ pattern: 'github.com/*', groupId: 'g1' }),
    ])
    expect(qc.getQueryData(['urlRules'])).toHaveLength(1)
  })

  it('uses cached query data instead of re-reading settings when cache is warm', async () => {
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(['urlRules'], [{ id: 'r1', pattern: 'a.com', groupId: 'g1', createdAt: 1 }])
    const { result } = renderHook(() => useAddUrlRule(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ pattern: 'b.com', groupId: 'g2' })
    })
    expect(mockGetSetting).not.toHaveBeenCalled()
    expect((qc.getQueryData(['urlRules']) as UrlRule[]).length).toBe(2)
  })
})

describe('useDeleteUrlRule', () => {
  beforeEach(() => vi.clearAllMocks())

  it('removes the matching rule by id', async () => {
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(['urlRules'], [
      { id: 'r1', pattern: 'a.com', groupId: 'g1', createdAt: 1 },
      { id: 'r2', pattern: 'b.com', groupId: 'g2', createdAt: 2 },
    ])
    const { result } = renderHook(() => useDeleteUrlRule(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('r1')
    })
    const next = qc.getQueryData(['urlRules']) as UrlRule[]
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe('r2')
  })
})

describe('useReorderUrlRule', () => {
  beforeEach(() => vi.clearAllMocks())

  it('moves a rule from one index to another', async () => {
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(['urlRules'], [
      { id: 'r1', pattern: 'a.com', groupId: 'g1', createdAt: 1 },
      { id: 'r2', pattern: 'b.com', groupId: 'g2', createdAt: 2 },
      { id: 'r3', pattern: 'c.com', groupId: 'g3', createdAt: 3 },
    ])
    const { result } = renderHook(() => useReorderUrlRule(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ from: 0, to: 2 })
    })
    const next = qc.getQueryData(['urlRules']) as UrlRule[]
    expect(next.map((r) => r.id)).toEqual(['r2', 'r3', 'r1'])
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
