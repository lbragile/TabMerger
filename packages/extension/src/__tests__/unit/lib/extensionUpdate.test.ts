import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UPDATE_AVAILABLE_STORAGE_KEY, UPDATE_BANNER_DISMISSED_STORAGE_KEY } from '@tabmerger/shared'
import {
  checkForUpdate,
  clearAppliedUpdate,
  compareVersions,
  dismissPendingUpdate,
  getPendingUpdate,
  getVisiblePendingUpdate,
  isManifestVersion,
  isUpdatableInstall,
  normalizeUpdateCheck,
  parsePendingUpdate,
  recordPendingUpdate,
  registerUpdateAvailable,
  restartToUpdate,
} from '@/lib/extensionUpdate'

/**
 * lib/extensionUpdate: the "update available" record (onUpdateAvailable, clear on worker start),
 * the banner's visibility rule and "Check for updates" across the browser API shapes.
 */

let store: Map<string, unknown>
let runtime: Record<string, unknown>
let updateListeners: ((details?: { version?: unknown }) => void)[]

function stubChrome(extra: Record<string, unknown> = {}, runtimeExtra: Record<string, unknown> = {}) {
  updateListeners = []
  runtime = {
    getManifest: () => ({ version: '3.4.0' }),
    reload: vi.fn(),
    onUpdateAvailable: { addListener: (cb: (d?: { version?: unknown }) => void) => updateListeners.push(cb) },
    ...runtimeExtra,
  }
  vi.stubGlobal('chrome', {
    runtime,
    storage: {
      local: {
        get: vi.fn(async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v)
        }),
        remove: vi.fn(async (key: string) => {
          store.delete(key)
        }),
      },
    },
    ...extra,
  })
}

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  store = new Map()
  stubChrome()
  vi.stubEnv('MODE', 'production')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('version helpers', () => {
  it('accepts 1 to 4 dot-separated integers only', () => {
    expect(isManifestVersion('3')).toBe(true)
    expect(isManifestVersion('4.1.0.6')).toBe(true)
    expect(isManifestVersion('3.1.0-beta.1')).toBe(false)
    expect(isManifestVersion('1.2.3.4.5')).toBe(false)
    expect(isManifestVersion(3)).toBe(false)
    expect(isManifestVersion('')).toBe(false)
  })

  it('compares numerically, missing parts count as 0', () => {
    expect(compareVersions('3.10.0', '3.9.9')).toBeGreaterThan(0)
    expect(compareVersions('3.4', '3.4.0')).toBe(0)
    expect(compareVersions('3.4.0', '3.4.0.1')).toBeLessThan(0)
  })

  it('parses only a well-formed record', () => {
    expect(parsePendingUpdate({ version: '3.5.0', detectedAt: 5 })).toEqual({ version: '3.5.0', detectedAt: 5 })
    expect(parsePendingUpdate({ version: 'x', detectedAt: 5 })).toBeNull()
    expect(parsePendingUpdate({ version: '3.5.0', detectedAt: 'now' })).toBeNull()
    expect(parsePendingUpdate(null)).toBeNull()
    expect(parsePendingUpdate('3.5.0')).toBeNull()
  })
})

describe('recordPendingUpdate', () => {
  it('stores { version, detectedAt } for a newer version', async () => {
    await recordPendingUpdate('3.5.0', 1000)
    expect(store.get(UPDATE_AVAILABLE_STORAGE_KEY)).toEqual({ version: '3.5.0', detectedAt: 1000 })
  })

  it('ignores the running version, an older one and non-versions', async () => {
    await recordPendingUpdate('3.4.0', 1)
    await recordPendingUpdate('3.3.9', 1)
    await recordPendingUpdate('evil<script>', 1)
    await recordPendingUpdate(undefined, 1)
    expect(store.has(UPDATE_AVAILABLE_STORAGE_KEY)).toBe(false)
  })

  it('keeps the first detection time when the same version is reported again', async () => {
    await recordPendingUpdate('3.5.0', 1000)
    await recordPendingUpdate('3.5.0', 2000)
    expect(await getPendingUpdate()).toEqual({ version: '3.5.0', detectedAt: 1000 })
  })

  it('replaces the record with a newer version', async () => {
    await recordPendingUpdate('3.5.0', 1000)
    await recordPendingUpdate('3.6.0', 2000)
    expect(await getPendingUpdate()).toEqual({ version: '3.6.0', detectedAt: 2000 })
  })
})

describe('clearAppliedUpdate (worker start)', () => {
  it('removes the record and its dismissal once the running version is the same or newer', async () => {
    store.set(UPDATE_AVAILABLE_STORAGE_KEY, { version: '3.4.0', detectedAt: 1 })
    store.set(UPDATE_BANNER_DISMISSED_STORAGE_KEY, '3.4.0')
    await clearAppliedUpdate()
    expect(store.has(UPDATE_AVAILABLE_STORAGE_KEY)).toBe(false)
    expect(store.has(UPDATE_BANNER_DISMISSED_STORAGE_KEY)).toBe(false)
  })

  it('removes an older record', async () => {
    store.set(UPDATE_AVAILABLE_STORAGE_KEY, { version: '3.0.0', detectedAt: 1 })
    await clearAppliedUpdate()
    expect(store.has(UPDATE_AVAILABLE_STORAGE_KEY)).toBe(false)
  })

  it('keeps a record that is still ahead of the running version', async () => {
    store.set(UPDATE_AVAILABLE_STORAGE_KEY, { version: '3.5.0', detectedAt: 1 })
    await clearAppliedUpdate()
    expect(store.get(UPDATE_AVAILABLE_STORAGE_KEY)).toEqual({ version: '3.5.0', detectedAt: 1 })
  })

  it('removes a malformed record and does nothing when there is none', async () => {
    await clearAppliedUpdate()
    expect(chrome.storage.local.remove).not.toHaveBeenCalled()
    store.set(UPDATE_AVAILABLE_STORAGE_KEY, 'garbage')
    await clearAppliedUpdate()
    expect(store.has(UPDATE_AVAILABLE_STORAGE_KEY)).toBe(false)
  })

  it('keeps the record when the running version is unknown', async () => {
    stubChrome({}, { getManifest: () => { throw new Error('no manifest') } })
    store.set(UPDATE_AVAILABLE_STORAGE_KEY, { version: '3.5.0', detectedAt: 1 })
    await clearAppliedUpdate()
    expect(store.has(UPDATE_AVAILABLE_STORAGE_KEY)).toBe(true)
  })
})

describe('registerUpdateAvailable', () => {
  it('records the version onUpdateAvailable reports and clears an applied one on start', async () => {
    store.set(UPDATE_AVAILABLE_STORAGE_KEY, { version: '3.4.0', detectedAt: 1 })
    registerUpdateAvailable()
    await flush()
    expect(store.has(UPDATE_AVAILABLE_STORAGE_KEY)).toBe(false)
    expect(updateListeners).toHaveLength(1)
    updateListeners[0]({ version: '3.5.0' })
    await flush()
    expect(store.get(UPDATE_AVAILABLE_STORAGE_KEY)).toMatchObject({ version: '3.5.0' })
  })

  it('does nothing harmful without the event (older browsers) or details', async () => {
    stubChrome({}, { onUpdateAvailable: undefined })
    expect(() => registerUpdateAvailable()).not.toThrow()
    stubChrome()
    registerUpdateAvailable()
    updateListeners[0](undefined)
    await flush()
    expect(store.has(UPDATE_AVAILABLE_STORAGE_KEY)).toBe(false)
  })
})

describe('banner visibility', () => {
  it('shows a newer, undismissed update', async () => {
    await recordPendingUpdate('3.5.0', 1)
    expect(await getVisiblePendingUpdate()).toEqual({ version: '3.5.0', detectedAt: 1 })
  })

  it('hides the dismissed version only', async () => {
    await recordPendingUpdate('3.5.0', 1)
    await dismissPendingUpdate('3.5.0')
    expect(await getVisiblePendingUpdate()).toBeNull()
    await recordPendingUpdate('3.6.0', 2)
    expect(await getVisiblePendingUpdate()).toEqual({ version: '3.6.0', detectedAt: 2 })
  })

  it('hides a record the running version already reached (worker has not cleared it yet)', async () => {
    store.set(UPDATE_AVAILABLE_STORAGE_KEY, { version: '3.4.0', detectedAt: 1 })
    expect(await getVisiblePendingUpdate()).toBeNull()
  })

  it('reads storage failures as nothing to show', async () => {
    vi.stubGlobal('chrome', { runtime, storage: { local: { get: vi.fn().mockRejectedValue(new Error('x')) } } })
    expect(await getVisiblePendingUpdate()).toBeNull()
  })

  it('restartToUpdate reloads the extension', () => {
    restartToUpdate()
    expect(runtime.reload).toHaveBeenCalledTimes(1)
  })
})

describe('normalizeUpdateCheck', () => {
  it('reads Chrome promise, callback, Firefox and array shapes', () => {
    expect(normalizeUpdateCheck({ status: 'update_available', version: '3.5.0' })).toEqual({ status: 'update_available', version: '3.5.0' })
    expect(normalizeUpdateCheck('update_available', { version: '3.5.0' })).toEqual({ status: 'update_available', version: '3.5.0' })
    expect(normalizeUpdateCheck({ status: 'update_available', details: { version: '3.5.0' } })).toEqual({ status: 'update_available', version: '3.5.0' })
    expect(normalizeUpdateCheck(['throttled', {}])).toEqual({ status: 'throttled' })
    expect(normalizeUpdateCheck({ status: 'no_update' })).toEqual({ status: 'no_update' })
  })

  it('drops a malformed version and reports unknown statuses as errors', () => {
    expect(normalizeUpdateCheck('update_available', { version: '<b>' })).toEqual({ status: 'update_available' })
    expect(normalizeUpdateCheck('weird')).toEqual({ status: 'error', message: 'weird' })
    expect(normalizeUpdateCheck(undefined)).toEqual({ status: 'error', message: 'unknown' })
  })
})

describe('isUpdatableInstall', () => {
  it('is false for a development build', async () => {
    vi.stubEnv('MODE', 'development')
    expect(await isUpdatableInstall()).toBe(false)
  })

  it('is false for an unpacked / temporary install', async () => {
    stubChrome({ management: { getSelf: vi.fn().mockResolvedValue({ installType: 'development' }) } })
    expect(await isUpdatableInstall()).toBe(false)
  })

  it('is true for a store install, and when getSelf is missing or fails', async () => {
    stubChrome({ management: { getSelf: vi.fn().mockResolvedValue({ installType: 'normal' }) } })
    expect(await isUpdatableInstall()).toBe(true)
    stubChrome({ management: { getSelf: vi.fn().mockRejectedValue(new Error('x')) } })
    expect(await isUpdatableInstall()).toBe(true)
    stubChrome()
    expect(await isUpdatableInstall()).toBe(true)
  })
})

describe('checkForUpdate', () => {
  it('promise form: update_available records the version for the banner', async () => {
    stubChrome({}, { requestUpdateCheck: vi.fn().mockResolvedValue({ status: 'update_available', version: '3.5.0' }) })
    expect(await checkForUpdate(42)).toEqual({ status: 'update_available', version: '3.5.0' })
    expect(store.get(UPDATE_AVAILABLE_STORAGE_KEY)).toEqual({ version: '3.5.0', detectedAt: 42 })
  })

  it('promise form: no_update and throttled record nothing', async () => {
    stubChrome({}, { requestUpdateCheck: vi.fn().mockResolvedValue({ status: 'no_update' }) })
    expect(await checkForUpdate()).toEqual({ status: 'no_update' })
    stubChrome({}, { requestUpdateCheck: vi.fn().mockResolvedValue({ status: 'throttled' }) })
    expect(await checkForUpdate()).toEqual({ status: 'throttled' })
    expect(store.has(UPDATE_AVAILABLE_STORAGE_KEY)).toBe(false)
  })

  it('a rejected promise is an error result, never a throw', async () => {
    stubChrome({}, { requestUpdateCheck: vi.fn().mockRejectedValue(new Error('boom')) })
    expect(await checkForUpdate()).toEqual({ status: 'error', message: 'boom' })
  })

  it('callback form: used when the call returns no promise', async () => {
    const requestUpdateCheck = vi.fn((cb?: (s: unknown, d?: unknown) => void) => {
      cb?.('update_available', { version: '3.6.0' })
      return undefined
    })
    stubChrome({}, { requestUpdateCheck })
    expect(await checkForUpdate()).toEqual({ status: 'update_available', version: '3.6.0' })
    expect(requestUpdateCheck).toHaveBeenCalledTimes(2)
  })

  it('callback form: used when the promise form throws, and lastError is an error', async () => {
    const requestUpdateCheck = vi.fn((cb?: (s: unknown) => void) => {
      if (!cb) throw new Error('callback required')
      runtime.lastError = { message: 'no update url' }
      cb(undefined)
      delete runtime.lastError
    })
    stubChrome({}, { requestUpdateCheck })
    expect(await checkForUpdate()).toEqual({ status: 'error', message: 'no update url' })
  })

  it('callback form throwing too is an error result', async () => {
    stubChrome({}, { requestUpdateCheck: vi.fn(() => { throw new Error('nope') }) })
    expect(await checkForUpdate()).toEqual({ status: 'error', message: 'nope' })
  })

  it('Firefox: prefers browser.runtime and reads { status, details }', async () => {
    const chromeCheck = vi.fn()
    stubChrome({}, { requestUpdateCheck: chromeCheck })
    vi.stubGlobal('browser', {
      runtime: { requestUpdateCheck: vi.fn().mockResolvedValue({ status: 'update_available', details: { version: '3.7.0' } }) },
    })
    expect(await checkForUpdate(7)).toEqual({ status: 'update_available', version: '3.7.0' })
    expect(chromeCheck).not.toHaveBeenCalled()
    expect(store.get(UPDATE_AVAILABLE_STORAGE_KEY)).toEqual({ version: '3.7.0', detectedAt: 7 })
  })

  it('development builds and browsers without the API are unsupported', async () => {
    const requestUpdateCheck = vi.fn()
    stubChrome({}, { requestUpdateCheck })
    vi.stubEnv('MODE', 'development')
    expect(await checkForUpdate()).toEqual({ status: 'unsupported' })
    expect(requestUpdateCheck).not.toHaveBeenCalled()
    vi.stubEnv('MODE', 'production')
    stubChrome()
    expect(await checkForUpdate()).toEqual({ status: 'unsupported' })
  })
})
