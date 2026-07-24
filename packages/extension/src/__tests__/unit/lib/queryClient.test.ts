import { describe, it, expect } from 'vitest'
import { queryClient } from '@/lib/queryClient'

describe('queryClient', () => {
  it('sets staleTime to Infinity since all data is local (IndexedDB-backed)', () => {
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(Infinity)
  })

  it('disables refetchOnWindowFocus and refetchOnReconnect', () => {
    const opts = queryClient.getDefaultOptions()
    expect(opts.queries?.refetchOnWindowFocus).toBe(false)
    expect(opts.queries?.refetchOnReconnect).toBe(false)
  })

  it('disables mutation retries', () => {
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(0)
  })
})
