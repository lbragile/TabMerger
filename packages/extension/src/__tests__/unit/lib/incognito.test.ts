import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockToastInfo } = vi.hoisted(() => ({ mockToastInfo: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { info: mockToastInfo } }))

import { isIncognitoAllowed, resolveIncognito } from '@/lib/incognito'

const original = globalThis.chrome

function setApi(fn: unknown) {
  globalThis.chrome = { extension: fn === undefined ? {} : { isAllowedIncognitoAccess: fn } } as unknown as typeof chrome
}

beforeEach(() => {
  mockToastInfo.mockClear()
})
afterEach(() => {
  globalThis.chrome = original
})

describe('isIncognitoAllowed', () => {
  it('is true when the API resolves true', async () => {
    setApi(vi.fn().mockResolvedValue(true))
    expect(await isIncognitoAllowed()).toBe(true)
  })

  it('is false when the API resolves false', async () => {
    setApi(vi.fn().mockResolvedValue(false))
    expect(await isIncognitoAllowed()).toBe(false)
  })

  it('is false when the API is missing', async () => {
    setApi(undefined)
    expect(await isIncognitoAllowed()).toBe(false)
    globalThis.chrome = undefined as unknown as typeof chrome
    expect(await isIncognitoAllowed()).toBe(false)
  })

  it('is false when the API throws (sync or rejected)', async () => {
    setApi(vi.fn(() => { throw new Error('boom') }))
    expect(await isIncognitoAllowed()).toBe(false)
    setApi(vi.fn().mockRejectedValue(new Error('nope')))
    expect(await isIncognitoAllowed()).toBe(false)
  })
})

describe('resolveIncognito', () => {
  it.each([false, undefined])('returns false with no toast and no API call when the window was not incognito (%s)', async (was) => {
    const api = vi.fn().mockResolvedValue(true)
    setApi(api)
    expect(await resolveIncognito(was)).toBe(false)
    expect(api).not.toHaveBeenCalled()
    expect(mockToastInfo).not.toHaveBeenCalled()
  })

  it('returns true with no toast when incognito and access is allowed', async () => {
    setApi(vi.fn().mockResolvedValue(true))
    expect(await resolveIncognito(true)).toBe(true)
    expect(mockToastInfo).not.toHaveBeenCalled()
  })

  it('returns false and toasts once with the fixed id when incognito but access is denied', async () => {
    setApi(vi.fn().mockResolvedValue(false))
    expect(await resolveIncognito(true)).toBe(false)
    expect(mockToastInfo).toHaveBeenCalledTimes(1)
    expect(mockToastInfo).toHaveBeenCalledWith(expect.stringContaining('Allow in Incognito'), { id: 'incognito-not-allowed' })
  })

  it('falls back (false + toast) when the API is missing', async () => {
    setApi(undefined)
    expect(await resolveIncognito(true)).toBe(false)
    expect(mockToastInfo).toHaveBeenCalledTimes(1)
  })
})
