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

function makeInsertBuilder(error: unknown = null) {
  const b: Record<string, unknown> = {}
  b.insert = vi.fn().mockResolvedValue({ error })
  // setup must never be able to REPLACE an existing key: an upsert call fails the test
  b.upsert = vi.fn(() => {
    throw new Error('setupEncryption must insert, never upsert')
  })
  return b
}

function makeSelectBuilder(row: unknown, error: unknown = null) {
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = () => b
  b.abortSignal = vi.fn(() => b)
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
    const builder = makeInsertBuilder(null)
    mockFrom.mockReturnValue(builder)
    mockGenerateDataKey.mockResolvedValue(fakeDataKey)
    mockDeriveWrappingKey.mockResolvedValue(fakeWrappingKey)
    mockWrapDataKey.mockResolvedValue({ wrappedKey: 'wrapped', iv: 'iv1' })

    const { setupEncryption, getDataKey } = await import('@/lib/encryptionKey')
    await setupEncryption('correct horse battery staple')

    expect(mockFrom).toHaveBeenCalledWith('encryption_keys')
    expect(builder.upsert).not.toHaveBeenCalled()
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', wrapped_key: 'wrapped', wrap_iv: 'iv1' })
    )
    // Marks the self-heal migration done so doSync doesn't redundantly re-mark
    // everything pending again on the very next sync after setup.
    expect(mockSetSetting).toHaveBeenCalledWith('encryptionMigrationDone', true)
    // sessions saved before setup were never uploaded: the next sync must upload them, encrypted
    expect(mockSetSetting).toHaveBeenCalledWith('sessionsEncryptionMigrationDone', false)
    expect(await getDataKey()).toBe(fakeDataKey)
  })

  it('throws when there is no active session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const { setupEncryption } = await import('@/lib/encryptionKey')
    await expect(setupEncryption('pass')).rejects.toThrow()
  })

  it('throws when the insert fails', async () => {
    const builder = makeInsertBuilder({ message: 'db down' })
    mockFrom.mockReturnValue(builder)
    mockGenerateDataKey.mockResolvedValue(fakeDataKey)
    mockDeriveWrappingKey.mockResolvedValue(fakeWrappingKey)
    mockWrapDataKey.mockResolvedValue({ wrappedKey: 'wrapped', iv: 'iv1' })

    const { setupEncryption } = await import('@/lib/encryptionKey')
    await expect(setupEncryption('pass')).rejects.toThrow('db down')
  })

  it('refuses to replace a key the account already has (unique violation), and keeps nothing locally', async () => {
    const builder = makeInsertBuilder({ code: '23505', message: 'duplicate key value violates unique constraint' })
    mockFrom.mockReturnValue(builder)
    mockGenerateDataKey.mockResolvedValue(fakeDataKey)
    mockDeriveWrappingKey.mockResolvedValue(fakeWrappingKey)
    mockWrapDataKey.mockResolvedValue({ wrappedKey: 'wrapped', iv: 'iv1' })

    const { setupEncryption, getDataKey, ENCRYPTION_ALREADY_SET_UP_MESSAGE } = await import('@/lib/encryptionKey')
    await expect(setupEncryption('pass')).rejects.toThrow(ENCRYPTION_ALREADY_SET_UP_MESSAGE)

    // the freshly generated key was never cached: it would encrypt data nobody can unlock
    expect(await getDataKey()).toBeNull()
    expect(mockSetSetting).not.toHaveBeenCalled()
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
    const result = await unlockEncryption('correct passphrase')

    expect(result).toBe('unlocked')
    expect(await getDataKey()).toBe(fakeDataKey)
  })

  it.each([
    ['the server rejects the request (401 / 5xx)', { message: 'JWT expired', code: 'PGRST301' }],
    ['the network is down', { message: 'TypeError: Failed to fetch' }],
  ])('reports "unavailable", NOT a wrong passphrase, when %s', async (_label, error) => {
    mockFrom.mockReturnValue(makeSelectBuilder(null, error))
    const { unlockEncryption, getDataKey } = await import('@/lib/encryptionKey')

    expect(await unlockEncryption('correct passphrase')).toBe('unavailable')
    expect(mockUnwrapDataKey).not.toHaveBeenCalled()
    expect(await getDataKey()).toBeNull()
  })

  it('reports "unavailable" when the request throws, and bounds it with the shared timeout', async () => {
    const builder = makeSelectBuilder(null)
    builder.maybeSingle = async () => {
      throw new Error('network down')
    }
    mockFrom.mockReturnValue(builder)
    const { unlockEncryption } = await import('@/lib/encryptionKey')

    expect(await unlockEncryption('correct passphrase')).toBe('unavailable')
    expect(builder.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal))
  })

  it('reports "wrong-passphrase" (not a throw) on a wrong passphrase', async () => {
    mockFrom.mockReturnValue(
      makeSelectBuilder({ salt: btoa('salt'), wrapped_key: 'wrapped', wrap_iv: 'iv1', kdf_iterations: 600000 })
    )
    mockDeriveWrappingKey.mockResolvedValue(fakeWrappingKey)
    mockUnwrapDataKey.mockRejectedValue(new Error('OperationError'))

    const { unlockEncryption, getDataKey } = await import('@/lib/encryptionKey')
    const result = await unlockEncryption('wrong passphrase')

    expect(result).toBe('wrong-passphrase')
    expect(await getDataKey()).toBeNull()
  })

  it('reports "no-key" when the server answers that there is no stored key row', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder(null))
    const { unlockEncryption } = await import('@/lib/encryptionKey')
    expect(await unlockEncryption('pass')).toBe('no-key')
  })

  it('reports "unavailable" when there is no active session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const { unlockEncryption } = await import('@/lib/encryptionKey')
    expect(await unlockEncryption('pass')).toBe('unavailable')
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

describe('getDataKey / getEncryptionKeyState', () => {
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
    expect(await mod1.unlockEncryption('correct passphrase')).toBe('unlocked')

    // Simulate the MV3 popup fully tearing down: module-scope `cachedDataKey` is wiped by
    // resetting the module registry and re-importing fresh, same as a real popup reopen.
    vi.resetModules()
    const mod2 = await import('@/lib/encryptionKey')

    // No unlockEncryption() call here — the key must come back from chrome.storage.local.
    expect(await mod2.getDataKey()).toBe(fakeDataKey)
  })

  it('never hands one account the data key another account unlocked in the same popup / worker lifetime', async () => {
    mockFrom.mockReturnValue(
      makeSelectBuilder({ salt: btoa('salt'), wrapped_key: 'wrapped', wrap_iv: 'iv1', kdf_iterations: 600000 })
    )
    mockDeriveWrappingKey.mockResolvedValue(fakeWrappingKey)
    mockUnwrapDataKey.mockResolvedValue(fakeDataKey)
    const { unlockEncryption, getDataKey } = await import('@/lib/encryptionKey')
    expect(await unlockEncryption('correct passphrase')).toBe('unlocked') // account u1
    expect(await getDataKey()).toBe(fakeDataKey)

    // u1 signs out and a different account signs in without the popup being reopened
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u2-other-account' } } } })
    expect(await getDataKey()).toBeNull() // u2 never unlocked on this device: its uploads must wait

    mockGetSession.mockResolvedValue({ data: { session: null } })
    expect(await getDataKey()).toBeNull()
  })

  it('is "present" when Supabase returns a row scoped to the current session user', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder({ user_id: 'u1' }))
    const { getEncryptionKeyState } = await import('@/lib/encryptionKey')
    expect(await getEncryptionKeyState()).toBe('present')
    expect(mockFrom).toHaveBeenCalledWith('encryption_keys')
  })

  it('is "absent" when the server answers that there is no row for this user (fresh/different account)', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder(null))
    const { getEncryptionKeyState } = await import('@/lib/encryptionKey')
    expect(await getEncryptionKeyState()).toBe('absent')
  })

  it('is "absent" when there is no active session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const { getEncryptionKeyState } = await import('@/lib/encryptionKey')
    expect(await getEncryptionKeyState()).toBe('absent')
  })

  it.each([
    ['an unauthorised request (401)', { message: 'JWT expired', code: 'PGRST301' }],
    ['a network failure', { message: 'TypeError: Failed to fetch' }],
    ['a timed-out request', { message: 'TimeoutError: signal timed out' }],
    ['a server error (5xx)', { message: 'Internal Server Error' }],
  ])('is "unknown", never "absent", after %s', async (_label, error) => {
    mockFrom.mockReturnValue(makeSelectBuilder(null, error))
    const { getEncryptionKeyState } = await import('@/lib/encryptionKey')
    expect(await getEncryptionKeyState()).toBe('unknown')
  })

  it('is "unknown" when the request or the session lookup throws', async () => {
    const builder = makeSelectBuilder(null)
    builder.maybeSingle = async () => {
      throw new Error('network down')
    }
    mockFrom.mockReturnValue(builder)
    const { getEncryptionKeyState } = await import('@/lib/encryptionKey')
    expect(await getEncryptionKeyState()).toBe('unknown')

    mockGetSession.mockRejectedValue(new Error('storage unavailable'))
    expect(await getEncryptionKeyState()).toBe('unknown')
  })

  it('bounds the request with the shared sync timeout', async () => {
    const builder = makeSelectBuilder({ user_id: 'u1' })
    mockFrom.mockReturnValue(builder)
    const { getEncryptionKeyState } = await import('@/lib/encryptionKey')
    await getEncryptionKeyState()
    expect(builder.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal))
  })

  it('a stale local flag from a previously signed-in account does not leak into a different account (regression)', async () => {
    // Account A set up encryption; account B (different user) signs in and has no row of its own.
    mockGetSetting.mockResolvedValue(true) // simulates old unscoped local flag, now unused
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u2-different-account' } } } })
    mockFrom.mockReturnValue(makeSelectBuilder(null))
    const { getEncryptionKeyState } = await import('@/lib/encryptionKey')
    expect(await getEncryptionKeyState()).toBe('absent')
  })
})
