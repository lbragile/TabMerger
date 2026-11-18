import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RECENTLY_CLOSED_LIMITS } from '@tabmerger/shared'

// The popup's catch-up prune: only a CONFIRMED Free plan (fresh server answer, or nobody signed in
// on a store no account owns) trims storage; a remembered paid answer is re-checked.

const mockGetSetting = vi.hoisted(() => vi.fn())
const mockSetSetting = vi.hoisted(() => vi.fn())
const mockGetSession = vi.hoisted(() => vi.fn())
const mockFetchTier = vi.hoisted(() => vi.fn())
const mockPrune = vi.hoisted(() => vi.fn())
const mockNotify = vi.hoisted(() => vi.fn())

vi.mock('@/lib/localDb', () => ({ getSetting: mockGetSetting, setSetting: mockSetSetting }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: mockGetSession } } }))
vi.mock('@/lib/entitlementTier', () => ({ fetchTier: mockFetchTier }))
vi.mock('@/lib/recentlyClosedDb', () => ({ pruneRecentlyClosed: mockPrune, notifyRecentlyClosedChanged: mockNotify }))

import { resolveRecentlyClosedPlan, trimRecentlyClosedIfFree } from '@/lib/recentlyClosedPlan'
import { resolveRecentlyClosedPlan as fromRecorder } from '@/lib/recentlyClosedRecorder'
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
  mockNotify.mockReset()
})

describe('resolveRecentlyClosedPlan({ fresh })', () => {
  it('the recorder re-exports the same function', () => {
    expect(fromRecorder).toBe(resolveRecentlyClosedPlan)
  })

  it('fresh asks the server even with a remembered paid answer (a downgrade), and remembers the answer', async () => {
    settings[AUTO_SAVE_TIER_SEEN_KEY] = { tier: 'pro', at: NOW - 1000 }
    mockFetchTier.mockResolvedValue('free')
    await expect(resolveRecentlyClosedPlan(NOW)).resolves.toBe('pro')
    expect(mockFetchTier).not.toHaveBeenCalled()
    await expect(resolveRecentlyClosedPlan(NOW, { fresh: true })).resolves.toBe('free')
    expect(mockFetchTier).toHaveBeenCalledWith('u1')
    expect(settings[AUTO_SAVE_TIER_SEEN_KEY]).toEqual({ tier: 'free', at: NOW })
  })

  it('fresh with the server unreachable is unknown', async () => {
    settings[AUTO_SAVE_TIER_SEEN_KEY] = { tier: 'free', at: NOW - 1000 }
    mockFetchTier.mockResolvedValue(null)
    await expect(resolveRecentlyClosedPlan(NOW, { fresh: true })).resolves.toBe('unknown')
  })

  it('a session read that throws counts as signed out', async () => {
    mockGetSession.mockRejectedValue(new Error('storage'))
    delete settings[LAST_USER_ID_KEY]
    await expect(resolveRecentlyClosedPlan(NOW, { fresh: true })).resolves.toBe('free')
  })

  it('fresh never overrides an account mismatch or a signed-out store an account owns', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u2' } } } })
    await expect(resolveRecentlyClosedPlan(NOW, { fresh: true })).resolves.toBe('unknown')
    mockGetSession.mockResolvedValue({ data: { session: null } })
    await expect(resolveRecentlyClosedPlan(NOW, { fresh: true })).resolves.toBe('unknown')
    expect(mockFetchTier).not.toHaveBeenCalled()
  })
})

describe('trimRecentlyClosedIfFree', () => {
  it('signed out on a store no account owns: prunes to the Free limits and tells other pages', async () => {
    delete settings[LAST_USER_ID_KEY]
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockPrune.mockResolvedValue({ deleted: 3, nextPurgeAt: null })
    await expect(trimRecentlyClosedIfFree(NOW)).resolves.toBe(3)
    expect(mockPrune).toHaveBeenCalledWith(RECENTLY_CLOSED_LIMITS.free, NOW)
    expect(mockNotify).toHaveBeenCalledTimes(1)
  })

  it('signed in and the server confirms Free: prunes; nothing deleted: no notice', async () => {
    mockFetchTier.mockResolvedValue('free')
    await expect(trimRecentlyClosedIfFree(NOW)).resolves.toBe(0)
    expect(mockPrune).toHaveBeenCalledWith(RECENTLY_CLOSED_LIMITS.free, NOW)
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('never prunes when the check fails (unknown) or the server says paid', async () => {
    mockFetchTier.mockResolvedValue(null)
    await expect(trimRecentlyClosedIfFree(NOW)).resolves.toBe(0)
    mockFetchTier.mockResolvedValue('pro_ai')
    await expect(trimRecentlyClosedIfFree(NOW)).resolves.toBe(0)
    expect(mockPrune).not.toHaveBeenCalled()
  })
})
