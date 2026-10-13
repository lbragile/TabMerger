import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveTier, fetchTier } from '@/lib/entitlementTier'

const h = vi.hoisted(() => ({ result: { data: null, error: null } as unknown, throws: false, eq: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: (...a: unknown[]) => {
          h.eq(...a)
          return {
            maybeSingle: async () => {
              if (h.throws) throw new Error('network down')
              return h.result
            },
          }
        },
      })),
    })),
  },
}))

beforeEach(() => {
  h.result = { data: null, error: null }
  h.throws = false
  h.eq.mockClear()
})

describe('resolveTier', () => {
  const statuses = ['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused', 'weird', '']
  const entitled = new Set(['active', 'trialing', 'past_due'])
  const tiers = ['free', 'pro', 'pro_ai', 'enterprise', '']

  for (const status of statuses) {
    for (const tier of tiers) {
      const expected = entitled.has(status) && (tier === 'pro' || tier === 'pro_ai') ? tier : 'free'
      it(`status "${status}" x tier "${tier}" -> ${expected}`, () => {
        expect(resolveTier({ status, tier })).toBe(expected)
      })
    }
  }

  it('no row is free', () => {
    expect(resolveTier(null)).toBe('free')
    expect(resolveTier(undefined)).toBe('free')
  })
})

describe('fetchTier', () => {
  it('reads the row of the given user', async () => {
    h.result = { data: { tier: 'pro', status: 'active' }, error: null }
    expect(await fetchTier('u1')).toBe('pro')
    expect(h.eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('pro_ai when that is the paid tier', async () => {
    h.result = { data: { tier: 'pro_ai', status: 'trialing' }, error: null }
    expect(await fetchTier('u1')).toBe('pro_ai')
  })

  it('a lapsed subscription is free', async () => {
    h.result = { data: { tier: 'pro', status: 'canceled' }, error: null }
    expect(await fetchTier('u1')).toBe('free')
  })

  it('no row is free', async () => {
    h.result = { data: null, error: null }
    expect(await fetchTier('u1')).toBe('free')
  })

  it('an error response is unknown (null), not free', async () => {
    h.result = { data: null, error: { message: 'boom' } }
    expect(await fetchTier('u1')).toBeNull()
  })

  it('a thrown request is unknown (null), not free', async () => {
    h.throws = true
    expect(await fetchTier('u1')).toBeNull()
  })
})
