import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSetting, mockSetSetting, mockClear } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockSetSetting: vi.fn().mockResolvedValue(undefined),
  mockClear: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/localDb', () => ({ getSetting: mockGetSetting, setSetting: mockSetSetting, clearLocalAccountData: mockClear }))

import { ensureAccountScope, resetAccountScopeForTests } from '@/lib/accountScope'

beforeEach(() => {
  vi.clearAllMocks()
  resetAccountScopeForTests()
})

describe('ensureAccountScope', () => {
  it('wipes when a DIFFERENT account was recorded, then records the new one, and reports the switch', async () => {
    mockGetSetting.mockResolvedValue('userA')
    await expect(ensureAccountScope('userB')).resolves.toBe(true)
    expect(mockClear).toHaveBeenCalledOnce()
    expect(mockSetSetting).toHaveBeenCalledWith('lastSignedInUserId', 'userB')
  })

  it('does not wipe for the same account or a first sign-in', async () => {
    mockGetSetting.mockResolvedValue('userA')
    await expect(ensureAccountScope('userA')).resolves.toBe(false)
    resetAccountScopeForTests()
    mockGetSetting.mockResolvedValue(null)
    await expect(ensureAccountScope('userA')).resolves.toBe(false)
    expect(mockClear).not.toHaveBeenCalled()
  })

  it('every concurrent caller awaits the SAME wipe (a first sync cannot start before it finishes)', async () => {
    mockGetSetting.mockResolvedValue('userA')
    let finishWipe!: () => void
    mockClear.mockReturnValue(new Promise<void>((r) => { finishWipe = r }))
    const order: string[] = []
    const effect = ensureAccountScope('userB').then(() => order.push('effect'))
    const sync = ensureAccountScope('userB').then(() => order.push('sync'))
    await Promise.resolve()
    expect(order).toEqual([]) // neither proceeds while the wipe is pending
    finishWipe()
    await Promise.all([effect, sync])
    expect(mockClear).toHaveBeenCalledOnce()
    expect(order.sort()).toEqual(['effect', 'sync'])
  })

  it('re-checks when the user changes within one popup lifetime (A -> B -> A)', async () => {
    mockGetSetting.mockResolvedValueOnce(null).mockResolvedValueOnce('userA').mockResolvedValueOnce('userB')
    await ensureAccountScope('userA')
    await ensureAccountScope('userB')
    await ensureAccountScope('userA')
    expect(mockClear).toHaveBeenCalledTimes(2)
  })
})
