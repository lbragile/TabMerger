import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockGetSession,
  mockFrom,
  mockGetSetting,
  mockSetSetting,
  mockDeriveWrappingKey,
  mockGenerateDataKey,
  mockWrapDataKey,
  mockUnwrapDataKey,
  mockExportKeyToBase64,
  mockImportKeyFromBase64
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockFrom: vi.fn(),
  mockGetSetting: vi.fn(),
  mockSetSetting: vi.fn(),
  mockDeriveWrappingKey: vi.fn(),
  mockGenerateDataKey: vi.fn(),
  mockWrapDataKey: vi.fn(),
  mockUnwrapDataKey: vi.fn(),
  mockExportKeyToBase64: vi.fn(),
  mockImportKeyFromBase64: vi.fn()
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession }, from: mockFrom }
}))

vi.mock('@/lib/localDb', () => ({
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
  markAllGroupsPendingSync: vi.fn()
}))

vi.mock('@tabmerger/shared', () => ({
  KDF_ITERATIONS: 600000,
  deriveWrappingKey: mockDeriveWrappingKey,
  generateDataKey: mockGenerateDataKey,
  wrapDataKey: mockWrapDataKey,
  unwrapDataKey: mockUnwrapDataKey,
  exportKeyToBase64: mockExportKeyToBase64,
  importKeyFromBase64: mockImportKeyFromBase64
}))

const fakeDataKey = { type: 'data-key' } as unknown as CryptoKey
const fakeWrappingKey = { type: 'wrapping-key' } as unknown as CryptoKey

function makeUpsertBuilder(error: unknown = null) {
  const b: Record<string, unknown> = {}
  b.upsert = vi.fn().mockResolvedValue({ error })
  return b
}

function makeSelectBuilder(row: unknown, error: unknown = null) {
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = () => b
  b.maybeSingle = async () => ({ data: row, error })
  return b
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules() // ponytail: cachedDataKey is module-scope state — force a fresh module per test
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
  // Single key round-trips through these tests, so a fixed base64 stand-in is enough —
  // export always yields it, import always yields the one fakeDataKey back.
  mockExportKeyToBase64.mockResolvedValue('b64-fake-data-key')
  mockImportKeyFromBase64.mockResolvedValue(fakeDataKey)
})

describe('setupEncryption', () => {
  it('generates, wraps, and uploads a data key, then caches it', async () => {
    const builder = makeUpsertBuilder(null)
    mockFrom.mockReturnValue(builder)
    mockGenerateDataKey.mockResolvedValue(fakeDataKey)
    mockDeriveWrappingKey.mockResolvedValue(fakeWrappingKey)
    mockWrapDataKey.mockResolvedValue({ wrappedKey: 'wrapped', iv: 'iv1' })

    const { setupEncryption, getDataKey } = await import('@/lib/encryptionKey')
    await setupEncryption('correct horse battery staple')

    expect(mockFrom).toHaveBeenCalledWith('encryption_keys')
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', wrapped_key: 'wrapped', wrap_iv: 'iv1' })
    )
    // Marks the self-heal migration done so doSync doesn't redundantly re-mark
    // everything pending again on the very next sync after setup.
    expect(mockSetSetting).toHaveBeenCalledWith('encryptionMigrationDone', true)
    expect(await getDataKey()).toBe(fakeDataKey)
  })

  it('throws when there is no active session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const { setupEncryption } = await import('@/lib/encryptionKey')
    await expect(setupEncryption('pass')).rejects.toThrow()
  })

  it('throws when the upsert fails', async () => {
    const builder = makeUpsertBuilder({ message: 'db down' })
    mockFrom.mockReturnValue(builder)
    mockGenerateDataKey.mockResolvedValue(fakeDataKey)
    mockDeriveWrappingKey.mockResolvedValue(fakeWrappingKey)
    mockWrapDataKey.mockResolvedValue({ wrappedKey: 'wrapped', iv: 'iv1' })

    const { setupEncryption } = await import('@/lib/encryptionKey')
    await expect(setupEncryption('pass')).rejects.toThrow('db down')
  })
})

describe('unlockEncryption', () => {
  it('re-derives the wrapping key and caches the unwrapped data key on success', async () => {
    mockFrom.mockReturnValue(
      makeSelectBuilder({ salt: btoa('salt'), wrapped_key: 'wrapped', wrap_iv: 'iv1', kdf_iterations: 600000 })
    )
    mockDeriveWrappingKey.mockResolvedValue(fakeWrappingKey)
    mockUnwrapDataKey.mockResolvedValue(fakeDataKey)

    const { unlockEncryption, getDataKey } = await import('@/lib/encryptionKey')
    const ok = await unlockEncryption('correct passphrase')

    expect(ok).toBe(true)
    expect(await getDataKey()).toBe(fakeDataKey)
  })

  it('returns false (not a throw) on a wrong passphrase', async () => {
    mockFrom.mockReturnValue(
      makeSelectBuilder({ salt: btoa('salt'), wrapped_key: 'wrapped', wrap_iv: 'iv1', kdf_iterations: 600000 })
    )
    mockDeriveWrappingKey.mockResolvedValue(fakeWrappingKey)
    mockUnwrapDataKey.mockRejectedValue(new Error('OperationError'))

    const { unlockEncryption, getDataKey } = await import('@/lib/encryptionKey')
    const ok = await unlockEncryption('wrong passphrase')

    expect(ok).toBe(false)
    expect(await getDataKey()).toBeNull()
  })

  it('returns false when there is no stored key row', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder(null))
    const { unlockEncryption } = await import('@/lib/encryptionKey')
    expect(await unlockEncryption('pass')).toBe(false)
  })

  it('returns false when there is no active session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const { unlockEncryption } = await import('@/lib/encryptionKey')
    expect(await unlockEncryption('pass')).toBe(false)
  })
})

describe('resetEncryption', () => {
  function makeDeleteBuilder(error: unknown = null) {
    const b: Record<string, unknown> = {}
    b.delete = () => b
    b.eq = vi.fn().mockResolvedValue({ error })
    return b
  }

  it('deletes the encryption_keys row and clears the cached data key', async () => {
    mockFrom.mockReturnValue(makeDeleteBuilder(null))
    const { resetEncryption, getDataKey } = await import('@/lib/encryptionKey')

    await resetEncryption()

    expect(mockFrom).toHaveBeenCalledWith('encryption_keys')
    expect(await getDataKey()).toBeNull()
  })

  it('throws when there is no active session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const { resetEncryption } = await import('@/lib/encryptionKey')
    await expect(resetEncryption()).rejects.toThrow()
  })

  it('throws when the delete fails', async () => {
    mockFrom.mockReturnValue(makeDeleteBuilder({ message: 'db down' }))
    const { resetEncryption } = await import('@/lib/encryptionKey')
    await expect(resetEncryption()).rejects.toThrow('db down')
  })

  it('re-arms the sessions self-heal flag so pre-existing sessions re-push under the new key', async () => {
    mockFrom.mockReturnValue(makeDeleteBuilder(null))
    const { resetEncryption, SESSIONS_MIGRATION_DONE_KEY } = await import('@/lib/encryptionKey')

    await resetEncryption()

    expect(mockSetSetting).toHaveBeenCalledWith(SESSIONS_MIGRATION_DONE_KEY, false)
  })
})

describe('getDataKey / hasEncryptionKey', () => {
  it('returns null before any setup/unlock call', async () => {
    const { getDataKey } = await import('@/lib/encryptionKey')
    expect(await getDataKey()).toBeNull()
  })

  it('survives popup teardown AND browser restart: unlock, reset module state, re-import — getDataKey still returns the key without re-unlocking', async () => {
    mockFrom.mockReturnValue(
      makeSelectBuilder({ salt: btoa('salt'), wrapped_key: 'wrapped', wrap_iv: 'iv1', kdf_iterations: 600000 })
    )
    mockDeriveWrappingKey.mockResolvedValue(fakeWrappingKey)
    mockUnwrapDataKey.mockResolvedValue(fakeDataKey)

    const mod1 = await import('@/lib/encryptionKey')
    expect(await mod1.unlockEncryption('correct passphrase')).toBe(true)

    // Simulate the MV3 popup fully tearing down: module-scope `cachedDataKey` is wiped by
    // resetting the module registry and re-importing fresh, same as a real popup reopen.
    vi.resetModules()
    const mod2 = await import('@/lib/encryptionKey')

    // No unlockEncryption() call here — the key must come back from chrome.storage.local.
    expect(await mod2.getDataKey()).toBe(fakeDataKey)
  })

  it('hasEncryptionKey queries Supabase for a row scoped to the current session user', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder({ user_id: 'u1' }))
    const { hasEncryptionKey } = await import('@/lib/encryptionKey')
    expect(await hasEncryptionKey()).toBe(true)
    expect(mockFrom).toHaveBeenCalledWith('encryption_keys')
  })

  it('hasEncryptionKey returns false when there is no row for this user (fresh/different account)', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder(null))
    const { hasEncryptionKey } = await import('@/lib/encryptionKey')
    expect(await hasEncryptionKey()).toBe(false)
  })

  it('hasEncryptionKey returns false when there is no active session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const { hasEncryptionKey } = await import('@/lib/encryptionKey')
    expect(await hasEncryptionKey()).toBe(false)
  })

  it('a stale local flag from a previously signed-in account does not leak into a different account (regression)', async () => {
    // Account A set up encryption; account B (different user) signs in and has no row of its own.
    mockGetSetting.mockResolvedValue(true) // simulates old unscoped local flag, now unused
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u2-different-account' } } } })
    mockFrom.mockReturnValue(makeSelectBuilder(null))
    const { hasEncryptionKey } = await import('@/lib/encryptionKey')
    expect(await hasEncryptionKey()).toBe(false)
  })
})
