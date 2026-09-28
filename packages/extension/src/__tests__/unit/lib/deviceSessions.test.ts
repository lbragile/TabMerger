import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GroupsState } from '@/lib/types'

const {
  mockGetSetting,
  mockSetSetting,
  mockGetSession,
  mockHasEncryptionKey,
  mockGetDataKey,
  mockEncryptBlob,
  mockDecryptBlob,
  mockCanUploadOnFirefox,
} = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockSetSetting: vi.fn(),
  mockGetSession: vi.fn(),
  mockHasEncryptionKey: vi.fn().mockResolvedValue(false),
  mockGetDataKey: vi.fn().mockReturnValue(null),
  mockEncryptBlob: vi.fn().mockResolvedValue({ iv: 'iv-stub', ct: 'ct-stub' }),
  mockDecryptBlob: vi.fn(),
  mockCanUploadOnFirefox: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/syncEngine', () => ({ canUploadOnFirefox: mockCanUploadOnFirefox }))

vi.mock('@/lib/localDb', () => ({
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
}))

vi.mock('@/lib/encryptionKey', () => ({
  hasEncryptionKey: () => mockHasEncryptionKey(),
  getDataKey: () => mockGetDataKey(),
}))

vi.mock('@tabmerger/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tabmerger/shared')>()
  return {
    ...actual,
    encryptBlob: (...args: unknown[]) => mockEncryptBlob(...args),
    decryptBlob: (...args: unknown[]) => mockDecryptBlob(...args),
  }
})

// ─── Supabase mock — client/builder separation (client must NOT be thenable) ──
function makeBuilder(responses: Array<{ data: unknown; error: unknown }>) {
  const builder: Record<string, (...args: unknown[]) => unknown> = {}
  const method = () => vi.fn((..._args: unknown[]) => builder)
  builder.from = method()
  builder.select = method()
  builder.upsert = method()
  builder.update = method()
  builder.delete = method()
  builder.in = method()
  builder.eq = method()
  builder.neq = method()
  builder.gte = method()
  builder.order = method()
  let idx = 0
  Object.defineProperty(builder, 'then', {
    get() {
      const r = responses[idx++] ?? { data: null, error: null }
      return (resolve: (v: unknown) => void) => Promise.resolve(r).then(resolve)
    },
    configurable: true,
    enumerable: false,
  })
  return builder
}

let currentBuilder: ReturnType<typeof makeBuilder>

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((...args: unknown[]) => currentBuilder.from(...args)),
    auth: { getSession: mockGetSession },
  },
}))

// Imports of the module under test — this module does not exist yet, so this
// import itself will fail with a "Cannot find module" error (expected red phase).
import {
  getOrCreateDeviceId,
  getDeviceName,
  pushDeviceSession,
  fetchDeviceSessions,
  renameDevice,
  removeDevices,
  DEVICE_SESSION_DEBOUNCE_MS,
} from '@/lib/deviceSessions'

function makeGroupsState(tabCount: number): GroupsState {
  const tabs = Array.from({ length: tabCount }, (_, i) => ({
    id: 0,
    title: `Tab ${i}`,
    url: `https://example.com/${i}`,
    favIconUrl: '',
  }))
  return {
    active: { id: 'now-open', index: 0 },
    available: [
      {
        id: 'now-open',
        name: 'Now Open',
        color: 'rgba(1,1,1,1)',
        updatedAt: Date.now(),
        permanent: true,
        starred: false,
        windows: [{ id: 1, tabs, incognito: false, focused: true, starred: false, name: 'Window' }],
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  currentBuilder = makeBuilder([])
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
  mockHasEncryptionKey.mockResolvedValue(false)
  mockGetDataKey.mockReturnValue(null)
  mockEncryptBlob.mockResolvedValue({ iv: 'iv-stub', ct: 'ct-stub' })
  mockDecryptBlob.mockReset()
  mockCanUploadOnFirefox.mockResolvedValue(true)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getOrCreateDeviceId', () => {
  it('generates and persists a UUID on first call', async () => {
    mockGetSetting.mockResolvedValueOnce(undefined)
    mockSetSetting.mockResolvedValueOnce(undefined)

    const id = await getOrCreateDeviceId()

    expect(id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(mockSetSetting).toHaveBeenCalledWith('deviceId:u1', id)
  })

  it('scopes the device id per signed-in user — two different users get two different ids', async () => {
    mockGetSetting.mockResolvedValue(undefined)
    mockSetSetting.mockResolvedValue(undefined)
    mockGetSession.mockResolvedValueOnce({ data: { session: { user: { id: 'user-a' } } }, error: null })

    const idA = await getOrCreateDeviceId()

    mockGetSession.mockResolvedValueOnce({ data: { session: { user: { id: 'user-b' } } }, error: null })
    const idB = await getOrCreateDeviceId()

    expect(idA).not.toBe(idB)
    expect(mockSetSetting).toHaveBeenCalledWith('deviceId:user-a', idA)
    expect(mockSetSetting).toHaveBeenCalledWith('deviceId:user-b', idB)
  })

  it('is idempotent — returns the same UUID once persisted', async () => {
    mockGetSetting.mockResolvedValueOnce('existing-device-id')

    const id = await getOrCreateDeviceId()

    expect(id).toBe('existing-device-id')
    expect(mockSetSetting).not.toHaveBeenCalled()
  })

  it('concurrent cold-cache calls share one generate+persist and return the same id', async () => {
    mockGetSetting.mockResolvedValue(undefined)
    mockSetSetting.mockResolvedValue(undefined)

    const [a, b] = await Promise.all([getOrCreateDeviceId(), getOrCreateDeviceId()])

    expect(a).toBe(b)
    expect(mockSetSetting).toHaveBeenCalledTimes(1)
  })
})

describe('getDeviceName', () => {
  it('derives a simple browser/os name from a Chrome userAgent', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    expect(getDeviceName(ua)).toBe('Chrome on Windows')
  })

  it('derives a simple browser/os name for macOS', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    expect(getDeviceName(ua)).toBe('Chrome on Mac')
  })

  it('falls back to a generic label for unrecognized user agents', () => {
    expect(getDeviceName('')).toBe('Unknown device')
  })
})

describe('pushDeviceSession (debounced push)', () => {
  it('does not push immediately — waits for the debounce window', () => {
    pushDeviceSession(makeGroupsState(3))

    expect(currentBuilder.from).not.toHaveBeenCalled()
  })

  it('pushes exactly once after the debounce window elapses, with correct payload shape', async () => {
    currentBuilder = makeBuilder([{ data: null, error: null }])

    pushDeviceSession(makeGroupsState(2))
    await vi.advanceTimersByTimeAsync(DEVICE_SESSION_DEBOUNCE_MS)

    expect(currentBuilder.from).toHaveBeenCalledWith('device_sessions')
    expect(currentBuilder.upsert).toHaveBeenCalledTimes(1)
    const payload = (currentBuilder.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload).toMatchObject({
      device_id: expect.any(String),
      device_name: expect.any(String),
      now_open_snapshot: expect.any(Object),
      last_active: expect.any(String),
    })
  })

  it('coalesces rapid successive calls into a single push', async () => {
    currentBuilder = makeBuilder([{ data: null, error: null }])

    pushDeviceSession(makeGroupsState(1))
    await vi.advanceTimersByTimeAsync(DEVICE_SESSION_DEBOUNCE_MS / 2)
    pushDeviceSession(makeGroupsState(2))
    await vi.advanceTimersByTimeAsync(DEVICE_SESSION_DEBOUNCE_MS)

    expect(currentBuilder.upsert).toHaveBeenCalledTimes(1)
  })

  it('handles a now_open_snapshot with zero tabs', async () => {
    currentBuilder = makeBuilder([{ data: null, error: null }])

    pushDeviceSession(makeGroupsState(0))
    await vi.advanceTimersByTimeAsync(DEVICE_SESSION_DEBOUNCE_MS)

    const payload = (currentBuilder.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload.now_open_snapshot).toBeDefined()
  })

  it('(Firefox) skips the push when browsingActivity consent is not granted', async () => {
    mockCanUploadOnFirefox.mockResolvedValue(false)
    currentBuilder = makeBuilder([{ data: null, error: null }])

    pushDeviceSession(makeGroupsState(2))
    await vi.advanceTimersByTimeAsync(DEVICE_SESSION_DEBOUNCE_MS)

    expect(currentBuilder.from).not.toHaveBeenCalled()
  })
})

describe('entitlement gating', () => {
  it('does not push for free tier', async () => {
    pushDeviceSession(makeGroupsState(2), 'free')
    await vi.advanceTimersByTimeAsync(DEVICE_SESSION_DEBOUNCE_MS)

    expect(currentBuilder.from).not.toHaveBeenCalled()
  })

  it('pushes for pro tier', async () => {
    currentBuilder = makeBuilder([{ data: null, error: null }])
    pushDeviceSession(makeGroupsState(2), 'pro')
    await vi.advanceTimersByTimeAsync(DEVICE_SESSION_DEBOUNCE_MS)

    expect(currentBuilder.from).toHaveBeenCalledWith('device_sessions')
  })

  it('pushes for pro_ai tier', async () => {
    currentBuilder = makeBuilder([{ data: null, error: null }])
    pushDeviceSession(makeGroupsState(2), 'pro_ai')
    await vi.advanceTimersByTimeAsync(DEVICE_SESSION_DEBOUNCE_MS)

    expect(currentBuilder.from).toHaveBeenCalledWith('device_sessions')
  })

  it('does not fetch devices for free tier', async () => {
    const result = await fetchDeviceSessions('free')
    expect(result).toEqual([])
    expect(currentBuilder.from).not.toHaveBeenCalled()
  })
})

describe('fetchDeviceSessions', () => {
  it('includes own device and filters devices older than 30 days', async () => {
    const now = Date.now()
    const fresh = { device_id: 'd2', device_name: 'Chrome on Mac', now_open_snapshot: { windows: [] }, last_active: new Date(now - 1000 * 60 * 5).toISOString() }
    const stale = { device_id: 'd3', device_name: 'Firefox on Linux', now_open_snapshot: { windows: [] }, last_active: new Date(now - 1000 * 60 * 60 * 24 * 31).toISOString() }
    currentBuilder = makeBuilder([{ data: [fresh], error: null }])
    mockGetSetting.mockResolvedValueOnce('d1')

    const result = await fetchDeviceSessions('pro')

    expect(currentBuilder.from).toHaveBeenCalledWith('device_sessions')
    expect(currentBuilder.gte).toHaveBeenCalled()
    // Dev env appends mock devices alongside real ones — real row is still present.
    expect(result).toContainEqual(fresh)
    expect(result).not.toContainEqual(stale)
  })

  it('returns an empty array when there are no other devices and not in a dev env — no dev-only mock leaks in', async () => {
    vi.stubEnv('DEV', false)
    currentBuilder = makeBuilder([{ data: [], error: null }])
    mockGetSetting.mockResolvedValueOnce('d1')

    const result = await fetchDeviceSessions('pro')

    expect(result).toEqual([])
    vi.unstubAllEnvs()
  })

  it('gracefully handles malformed/missing snapshot data', async () => {
    const malformed = { device_id: 'd4', device_name: 'Weird device', now_open_snapshot: null, last_active: new Date().toISOString() }
    currentBuilder = makeBuilder([{ data: [malformed], error: null }])
    mockGetSetting.mockResolvedValueOnce('d1')

    const result = await fetchDeviceSessions('pro')

    // Dev env appends mock devices alongside the one real (malformed) row.
    expect(result).toContainEqual(malformed)
    expect(result[0].now_open_snapshot).toBeFalsy()
  })
})

describe('renameDevice', () => {
  it('updates device_name only for own device via device_id match', async () => {
    currentBuilder = makeBuilder([{ data: null, error: null }])
    mockGetSetting.mockResolvedValueOnce('d1')

    await renameDevice('New name')

    expect(currentBuilder.from).toHaveBeenCalledWith('device_sessions')
    expect(currentBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ device_name: 'New name' }))
    expect(currentBuilder.eq).toHaveBeenCalledWith('device_id', 'd1')
    expect(currentBuilder.eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('is a no-op when there is no active session (logged out)', async () => {
    mockGetSetting.mockResolvedValue('d1')
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
    currentBuilder = makeBuilder([])

    await renameDevice('New name')

    expect(currentBuilder.update).not.toHaveBeenCalled()
  })
})

describe('removeDevices', () => {
  it('deletes device_sessions rows by id, scoped to the current user', async () => {
    currentBuilder = makeBuilder([{ data: null, error: null }])

    await removeDevices(['row-1', 'row-2'])

    expect(currentBuilder.from).toHaveBeenCalledWith('device_sessions')
    expect(currentBuilder.delete).toHaveBeenCalledTimes(1)
    expect(currentBuilder.in).toHaveBeenCalledWith('id', ['row-1', 'row-2'])
    expect(currentBuilder.eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('is a no-op with an empty id list — does not hit Supabase', async () => {
    currentBuilder = makeBuilder([])

    await removeDevices([])

    expect(currentBuilder.from).not.toHaveBeenCalled()
  })

  it('is a no-op when there is no active session (logged out)', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null })
    currentBuilder = makeBuilder([])

    await removeDevices(['row-1'])

    expect(currentBuilder.delete).not.toHaveBeenCalled()
  })
})

describe('device session encryption', () => {
  it('encrypts now_open_snapshot before push when encryption is enabled and unlocked', async () => {
    currentBuilder = makeBuilder([{ data: null, error: null }])
    mockHasEncryptionKey.mockResolvedValue(true)
    mockGetDataKey.mockReturnValue({} as CryptoKey)

    pushDeviceSession(makeGroupsState(2))
    await vi.advanceTimersByTimeAsync(DEVICE_SESSION_DEBOUNCE_MS)

    const payload = (currentBuilder.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload.now_open_snapshot).toEqual({ v: 1, iv: 'iv-stub', ct: 'ct-stub' })
  })

  it('skips the push when encryption is enabled but the key is locked', async () => {
    currentBuilder = makeBuilder([{ data: null, error: null }])
    mockHasEncryptionKey.mockResolvedValue(true)
    mockGetDataKey.mockReturnValue(null)

    pushDeviceSession(makeGroupsState(2))
    await vi.advanceTimersByTimeAsync(DEVICE_SESSION_DEBOUNCE_MS)

    expect(currentBuilder.upsert).not.toHaveBeenCalled()
  })

  it('decrypts an encrypted now_open_snapshot when fetching other devices with an unlocked key', async () => {
    const decryptedContent = { windows: [{ tabs: [{ title: 'T', url: 'https://a.com' }] }] }
    mockDecryptBlob.mockResolvedValue(decryptedContent)
    const encryptedRow = { device_id: 'd2', device_name: 'Chrome on Mac', now_open_snapshot: { v: 1, iv: 'x', ct: 'y' }, last_active: new Date().toISOString() }
    currentBuilder = makeBuilder([{ data: [encryptedRow], error: null }])
    mockGetSetting.mockResolvedValueOnce('d1')
    mockGetDataKey.mockReturnValue({} as CryptoKey)

    const result = await fetchDeviceSessions('pro')

    const decoded = result.find((d) => d.device_id === 'd2')
    expect(decoded?.now_open_snapshot).toEqual(decryptedContent)
  })

  it('returns now_open_snapshot: null (degrades like a malformed row) when an encrypted row is locked', async () => {
    const encryptedRow = { device_id: 'd2', device_name: 'Chrome on Mac', now_open_snapshot: { v: 1, iv: 'x', ct: 'y' }, last_active: new Date().toISOString() }
    currentBuilder = makeBuilder([{ data: [encryptedRow], error: null }])
    mockGetSetting.mockResolvedValueOnce('d1')
    mockGetDataKey.mockReturnValue(null)

    const result = await fetchDeviceSessions('pro')

    const decoded = result.find((d) => d.device_id === 'd2')
    expect(decoded?.now_open_snapshot).toBeNull()
  })
})

describe('documented tradeoffs (ponytail comments in deviceSessions.ts)', () => {
  it('a failed push does not throw and does not retry — logs and drops silently', async () => {
    currentBuilder = makeBuilder([{ data: null, error: { message: 'network error' } }])
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    pushDeviceSession(makeGroupsState(1))
    await expect(vi.advanceTimersByTimeAsync(DEVICE_SESSION_DEBOUNCE_MS)).resolves.not.toThrow()

    expect(currentBuilder.upsert).toHaveBeenCalledTimes(1)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to push'), 'network error')

    // No automatic retry: advancing time further does not push again.
    await vi.advanceTimersByTimeAsync(DEVICE_SESSION_DEBOUNCE_MS * 2)
    expect(currentBuilder.upsert).toHaveBeenCalledTimes(1)

    consoleSpy.mockRestore()
  })

  it('does not push if there is no active session (logged out) — silently no-ops, not an error', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null })
    currentBuilder = makeBuilder([])

    pushDeviceSession(makeGroupsState(1))
    await vi.advanceTimersByTimeAsync(DEVICE_SESSION_DEBOUNCE_MS)

    expect(currentBuilder.upsert).not.toHaveBeenCalled()
  })
})
