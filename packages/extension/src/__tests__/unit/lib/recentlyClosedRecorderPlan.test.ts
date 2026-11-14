import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_SAVE_FREE_RECHECK_MS, RECENTLY_CLOSED_LIMITS } from '@tabmerger/shared'

// The plan "Recently closed" prunes for. Pruning DELETES entries, so a remembered "free" answer is
// trusted only while it is recent: a user who upgraded since must get the Pro limits.

const mockGetSetting = vi.hoisted(() => vi.fn())
const mockSetSetting = vi.hoisted(() => vi.fn())
const mockGetSession = vi.hoisted(() => vi.fn())
const mockFetchTier = vi.hoisted(() => vi.fn())
const mockPrune = vi.hoisted(() => vi.fn())

vi.mock('@/lib/localDb', () => ({ getSetting: mockGetSetting, setSetting: mockSetSetting }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: mockGetSession } } }))
vi.mock('@/lib/entitlementTier', () => ({ fetchTier: mockFetchTier }))
vi.mock('@/lib/recentlyClosedDb', () => ({
  addRecentlyClosedEntry: vi.fn(),
  pruneRecentlyClosed: mockPrune,
  purgeClearedRecentlyClosed: vi.fn().mockResolvedValue({ deleted: 0, nextPurgeAt: null }),
  notifyRecentlyClosedChanged: vi.fn(),
}))

import { createRecentlyClosedRecorder, resolveRecentlyClosedPlan } from '@/lib/recentlyClosedRecorder'
import { AUTO_SAVE_TIER_SEEN_KEY, LAST_USER_ID_KEY } from '@/lib/syncSettingKeys'

const NOW = 1_800_000_000_000
let settings: Record<string, unknown>

beforeEach(() => {
  settings = { [LAST_USER_ID_KEY]: 'u1' }
  mockGetSetting.mockReset().mockImplementation(async (key: string, fallback: unknown) => (key in settings ? settings[key] : fallback))
  mockSetSetting.mockReset().mockImplementation(async (key: string, value: unknown) => {
    settings[key] = value
  })
  mockGetSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
  mockFetchTier.mockReset()
  mockPrune.mockReset().mockResolvedValue({ deleted: 0, nextPurgeAt: null })
  ;(globalThis as { chrome?: unknown }).chrome = {
    tabs: { query: vi.fn().mockResolvedValue([]) },
    storage: { session: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) } },
  }
})

describe('resolveRecentlyClosedPlan: remembered answers', () => {
  it('a stale "free" asks the server again: an upgrade since gives the Pro limits, remembered', async () => {
    settings[AUTO_SAVE_TIER_SEEN_KEY] = { tier: 'free', at: NOW - AUTO_SAVE_FREE_RECHECK_MS - 1 }
    mockFetchTier.mockResolvedValue('pro')
    await expect(resolveRecentlyClosedPlan(NOW)).resolves.toBe('pro')
    expect(mockFetchTier).toHaveBeenCalledWith('u1')
    expect(settings[AUTO_SAVE_TIER_SEEN_KEY]).toEqual({ tier: 'pro', at: NOW })
  })

  it('a recent "free" gives the Free limits without a request', async () => {
    settings[AUTO_SAVE_TIER_SEEN_KEY] = { tier: 'free', at: NOW - 1000 }
    await expect(resolveRecentlyClosedPlan(NOW)).resolves.toBe('free')
    expect(mockFetchTier).not.toHaveBeenCalled()
  })

  it('a remembered paid answer is trusted however old, without a request', async () => {
    settings[AUTO_SAVE_TIER_SEEN_KEY] = { tier: 'pro', at: NOW - 365 * 86_400_000 }
    await expect(resolveRecentlyClosedPlan(NOW)).resolves.toBe('pro')
    settings[AUTO_SAVE_TIER_SEEN_KEY] = { tier: 'pro_ai', at: NOW - 365 * 86_400_000 }
    await expect(resolveRecentlyClosedPlan(NOW)).resolves.toBe('pro')
    expect(mockFetchTier).not.toHaveBeenCalled()
  })

  it('a stale "free" with the server unreachable is unknown (Pro limits), never Free', async () => {
    settings[AUTO_SAVE_TIER_SEEN_KEY] = { tier: 'free', at: NOW - AUTO_SAVE_FREE_RECHECK_MS - 1 }
    mockFetchTier.mockResolvedValue(null)
    await expect(resolveRecentlyClosedPlan(NOW)).resolves.toBe('unknown')
  })

  it('signed out with the account still in the store: a stale "free" is unknown', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    settings[AUTO_SAVE_TIER_SEEN_KEY] = { tier: 'free', at: NOW - AUTO_SAVE_FREE_RECHECK_MS - 1 }
    await expect(resolveRecentlyClosedPlan(NOW)).resolves.toBe('unknown')
    expect(mockFetchTier).not.toHaveBeenCalled()
  })
})

describe('worker sweep after an upgrade', () => {
  it('prunes with the Pro limits, not the stale Free ones', async () => {
    settings[AUTO_SAVE_TIER_SEEN_KEY] = { tier: 'free', at: NOW - AUTO_SAVE_FREE_RECHECK_MS - 1 }
    mockFetchTier.mockResolvedValue('pro')
    const recorder = createRecentlyClosedRecorder({ now: () => NOW })
    await recorder.ready
    await recorder.sweep()
    expect(mockPrune).toHaveBeenCalledWith(RECENTLY_CLOSED_LIMITS.pro, NOW)
    expect(mockPrune).not.toHaveBeenCalledWith(RECENTLY_CLOSED_LIMITS.free, expect.anything())
    recorder.dispose()
  })
})
