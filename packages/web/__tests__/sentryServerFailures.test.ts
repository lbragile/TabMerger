/**
 * Lazy server Sentry under concurrency and failure: concurrent first errors share one import and
 * one init, a failed import is not cached and is retried, and `onRequestError` never throws into
 * Next (a reporting problem must not turn into a second failure on the request that already failed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loads: 0,
  failLoads: 0,
  init: vi.fn(),
  capture: vi.fn(),
}))

/** Registers the SDK mock for the next import; `fail` makes the module throw while loading. */
function mockSdk(fail = false) {
  vi.doMock('@sentry/nextjs', () => {
    h.loads += 1
    if (fail) throw new Error('module not found: secret-path')
    return { init: h.init, captureRequestError: h.capture }
  })
}

const request = { path: '/x', method: 'GET', headers: {} }
const context = {
  routerKind: 'App Router',
  routePath: '/x',
  routeType: 'route',
  renderSource: undefined,
  revalidateReason: undefined,
} as const

async function load() {
  vi.resetModules()
  mockSdk(h.failLoads > 0)
  return {
    sentry: await import('@/lib/sentryServer'),
    instrumentation: await import('@/instrumentation'),
  }
}

beforeEach(() => {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs')
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://sentry.invalid/1')
  vi.stubEnv('NEXT_PUBLIC_E2E_TEST', '')
  h.loads = 0
  h.failLoads = 0
  h.init.mockReset()
  h.capture.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('concurrent first errors', () => {
  it('trigger one import and one init, and every error is still reported', async () => {
    const { instrumentation } = await load()
    const errors = Array.from({ length: 8 }, (_, i) => new Error(`boom ${i}`))
    await Promise.all(errors.map((e) => instrumentation.onRequestError(e, request, context)))
    expect(h.loads).toBe(1)
    expect(h.init).toHaveBeenCalledTimes(1)
    expect(h.capture).toHaveBeenCalledTimes(8)
    for (const e of errors) expect(h.capture).toHaveBeenCalledWith(e, request, context)
  })

  it('getServerSentry callers racing before the import settles get the same instance', async () => {
    const { sentry } = await load()
    const results = await Promise.all([sentry.getServerSentry(), sentry.getServerSentry(), sentry.getServerSentry()])
    expect(new Set(results).size).toBe(1)
    expect(h.loads).toBe(1)
    expect(h.init).toHaveBeenCalledTimes(1)
  })
})

describe('a failed import', () => {
  it('resolves null (never rejects), logs without throwing, and is not cached: the next call retries', async () => {
    h.failLoads = 1
    const { sentry } = await load()
    await expect(sentry.getServerSentry()).resolves.toBeNull()
    expect(console.error).toHaveBeenCalled()
    expect(h.init).not.toHaveBeenCalled()

    mockSdk() // the module is available on the next attempt
    const retry = await sentry.getServerSentry()
    expect(retry).not.toBeNull()
    expect(h.loads).toBe(2)
    expect(h.init).toHaveBeenCalledTimes(1)
    // And after a success it is cached again.
    await sentry.getServerSentry()
    expect(h.loads).toBe(2)
  })

  it('onRequestError swallows the failed import, reports nothing, and reports the next error', async () => {
    h.failLoads = 1
    const { instrumentation } = await load()
    await expect(instrumentation.onRequestError(new Error('first'), request, context)).resolves.toBeUndefined()
    expect(h.capture).not.toHaveBeenCalled()
    mockSdk()
    const second = new Error('second')
    await instrumentation.onRequestError(second, request, context)
    expect(h.capture).toHaveBeenCalledTimes(1)
    expect(h.capture).toHaveBeenCalledWith(second, request, context)
  })

  it('concurrent errors during a failing import all resolve without throwing', async () => {
    h.failLoads = 1
    const { instrumentation } = await load()
    await expect(
      Promise.all([1, 2, 3].map((n) => instrumentation.onRequestError(new Error(`e${n}`), request, context)))
    ).resolves.toBeDefined()
    expect(h.loads).toBe(1)
  })
})

describe('onRequestError never throws into Next', () => {
  it('when the SDK fails to initialise', async () => {
    h.init.mockImplementationOnce(() => {
      throw new Error('bad dsn')
    })
    const { instrumentation } = await load()
    await expect(instrumentation.onRequestError(new Error('x'), request, context)).resolves.toBeUndefined()
    expect(h.capture).not.toHaveBeenCalled()
  })

  it('when reporting itself throws', async () => {
    h.capture.mockImplementationOnce(() => {
      throw new Error('transport exploded')
    })
    const { instrumentation } = await load()
    await expect(instrumentation.onRequestError(new Error('x'), request, context)).resolves.toBeUndefined()
  })

  it('when reporting rejects', async () => {
    h.capture.mockRejectedValueOnce(new Error('transport rejected: secret-detail'))
    const { instrumentation } = await load()
    await expect(instrumentation.onRequestError(new Error('x'), request, context)).resolves.toBeUndefined()
  })

  it('logs only a fixed message, never the error details', async () => {
    h.capture.mockImplementationOnce(() => {
      throw new Error('transport exploded: secret-detail')
    })
    const { instrumentation } = await load()
    await instrumentation.onRequestError(new Error('x'), request, context)
    expect(console.error).toHaveBeenCalledWith('[TabMerger] Reporting a request error failed')
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret-detail')
  })
})
