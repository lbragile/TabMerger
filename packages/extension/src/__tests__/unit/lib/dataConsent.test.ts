import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

async function importFresh() {
  vi.resetModules()
  return import('@/lib/dataConsent')
}

describe('dataConsent — non-Firefox (default)', () => {
  beforeEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = {
      permissions: { contains: vi.fn(), request: vi.fn() },
    }
  })

  it('hasDataConsent resolves true without calling chrome.permissions', async () => {
    const { hasDataConsent } = await importFresh()
    const contains = (globalThis as unknown as { chrome: { permissions: { contains: ReturnType<typeof vi.fn> } } }).chrome.permissions.contains
    await expect(hasDataConsent(['browsingActivity'])).resolves.toBe(true)
    expect(contains).not.toHaveBeenCalled()
  })

  it('requestDataConsent resolves true without calling chrome.permissions', async () => {
    const { requestDataConsent } = await importFresh()
    const request = (globalThis as unknown as { chrome: { permissions: { request: ReturnType<typeof vi.fn> } } }).chrome.permissions.request
    await expect(requestDataConsent(['authenticationInfo'])).resolves.toBe(true)
    expect(request).not.toHaveBeenCalled()
  })

  it('treats an empty category list as always-granted even conceptually on Firefox', async () => {
    const { hasDataConsent } = await importFresh()
    await expect(hasDataConsent([])).resolves.toBe(true)
  })
})

describe('dataConsent — Firefox build', () => {
  beforeEach(() => {
    vi.stubEnv('FIREFOX', 'true')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('hasDataConsent calls chrome.permissions.contains with the data_collection shape', async () => {
    const contains = vi.fn().mockResolvedValue(true)
    ;(globalThis as { chrome?: unknown }).chrome = { permissions: { contains, request: vi.fn() } }
    const { hasDataConsent } = await importFresh()
    await expect(hasDataConsent(['browsingActivity'])).resolves.toBe(true)
    expect(contains).toHaveBeenCalledWith({ data_collection: ['browsingActivity'] })
  })

  it('hasDataConsent resolves false when contains rejects', async () => {
    const contains = vi.fn().mockRejectedValue(new Error('nope'))
    ;(globalThis as { chrome?: unknown }).chrome = { permissions: { contains, request: vi.fn() } }
    const { hasDataConsent } = await importFresh()
    await expect(hasDataConsent(['browsingActivity'])).resolves.toBe(false)
  })

  it('requestDataConsent calls chrome.permissions.request and returns the grant result', async () => {
    const request = vi.fn().mockResolvedValue(true)
    ;(globalThis as { chrome?: unknown }).chrome = { permissions: { contains: vi.fn(), request } }
    const { requestDataConsent } = await importFresh()
    await expect(requestDataConsent(['authenticationInfo', 'personallyIdentifyingInfo'])).resolves.toBe(true)
    expect(request).toHaveBeenCalledWith({ data_collection: ['authenticationInfo', 'personallyIdentifyingInfo'] })
  })

  it('requestDataConsent returns false when the user denies', async () => {
    const request = vi.fn().mockResolvedValue(false)
    ;(globalThis as { chrome?: unknown }).chrome = { permissions: { contains: vi.fn(), request } }
    const { requestDataConsent } = await importFresh()
    await expect(requestDataConsent(['browsingActivity'])).resolves.toBe(false)
  })

  it('requestDataConsent resolves false when request throws', async () => {
    const request = vi.fn().mockRejectedValue(new Error('denied by policy'))
    ;(globalThis as { chrome?: unknown }).chrome = { permissions: { contains: vi.fn(), request } }
    const { requestDataConsent } = await importFresh()
    await expect(requestDataConsent(['browsingActivity'])).resolves.toBe(false)
  })

  it('getCachedDataConsent reflects the last hasDataConsent/requestDataConsent result', async () => {
    const contains = vi.fn().mockResolvedValue(true)
    ;(globalThis as { chrome?: unknown }).chrome = { permissions: { contains, request: vi.fn() } }
    const { hasDataConsent, getCachedDataConsent } = await importFresh()
    expect(getCachedDataConsent('browsingActivity')).toBeUndefined()
    await hasDataConsent(['browsingActivity'])
    expect(getCachedDataConsent('browsingActivity')).toBe(true)
  })

  it('registers permissions.onAdded/onRemoved listeners and updates the cache on revocation', async () => {
    let addedHandler: ((perms: { data_collection?: string[] }) => void) | undefined
    let removedHandler: ((perms: { data_collection?: string[] }) => void) | undefined
    ;(globalThis as { chrome?: unknown }).chrome = {
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn(),
        onAdded: { addListener: (cb: typeof addedHandler) => { addedHandler = cb } },
        onRemoved: { addListener: (cb: typeof removedHandler) => { removedHandler = cb } },
      },
    }
    const { hasDataConsent, getCachedDataConsent } = await importFresh()
    await hasDataConsent(['browsingActivity']) // registers the listeners as a side effect
    expect(addedHandler).toBeTypeOf('function')
    expect(removedHandler).toBeTypeOf('function')

    removedHandler?.({ data_collection: ['browsingActivity'] })
    expect(getCachedDataConsent('browsingActivity')).toBe(false)

    addedHandler?.({ data_collection: ['browsingActivity'] })
    expect(getCachedDataConsent('browsingActivity')).toBe(true)
  })
})
