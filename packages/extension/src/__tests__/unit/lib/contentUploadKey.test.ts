import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContentUploadKey } from '@/lib/contentUploadKey'

const { mockGetEncryptionKeyState, mockGetDataKey } = vi.hoisted(() => ({
  mockGetEncryptionKeyState: vi.fn(),
  mockGetDataKey: vi.fn(),
}))

vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: mockGetEncryptionKeyState,
  getDataKey: mockGetDataKey,
}))

const key = { type: 'data-key' } as unknown as CryptoKey

beforeEach(() => {
  vi.clearAllMocks()
  mockGetDataKey.mockResolvedValue(key)
})

// The single gate every content upload goes through: a key to encrypt with, or no upload at all.
describe('getContentUploadKey', () => {
  it('hands out the data key when the account has a key and this device unlocked it', async () => {
    mockGetEncryptionKeyState.mockResolvedValue('present')
    expect(await getContentUploadKey()).toEqual({ key })
  })

  it.each([
    ['absent', 'no-key'],
    ['unknown', 'unknown'],
  ] as const)('blocks the upload when the key state is %s (reason %s), without touching the stored key', async (state, reason) => {
    mockGetEncryptionKeyState.mockResolvedValue(state)
    expect(await getContentUploadKey()).toEqual({ key: null, reason })
    expect(mockGetDataKey).not.toHaveBeenCalled()
  })

  it('blocks the upload when the key exists but is locked on this device', async () => {
    mockGetEncryptionKeyState.mockResolvedValue('present')
    mockGetDataKey.mockResolvedValue(null)
    expect(await getContentUploadKey()).toEqual({ key: null, reason: 'locked' })
  })

  it('treats an unreadable stored key as locked instead of throwing', async () => {
    mockGetEncryptionKeyState.mockResolvedValue('present')
    mockGetDataKey.mockRejectedValue(new Error('corrupt key material'))
    expect(await getContentUploadKey()).toEqual({ key: null, reason: 'locked' })
  })
})
