/**
 * Server-side Sentry is loaded on first use (lib/sentryServer.ts), never at boot: instrumentation.ts
 * has no static `@sentry/nextjs` import, `register()` initialises nothing, and `onRequestError`
 * loads, initialises once and forwards. Off without a DSN, off the Node.js runtime and in
 * automated test runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const { mockInit, mockCaptureRequestError, sdkLoads } = vi.hoisted(() => ({
  mockInit: vi.fn(),
  mockCaptureRequestError: vi.fn(),
  sdkLoads: { count: 0 },
}))
vi.mock('@sentry/nextjs', () => {
  sdkLoads.count += 1
  return { init: mockInit, captureRequestError: mockCaptureRequestError }
})

const DSN = 'https://sentry.invalid/1'

function enable() {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs')
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', DSN)
  vi.stubEnv('NEXT_PUBLIC_E2E_TEST', '')
  vi.stubEnv('DEPLOY_ENV', 'preview')
}

/** A fresh module graph: a process that hasn't loaded the SDK yet. */
async function load() {
  vi.resetModules()
  return {
    sentry: await import('@/lib/sentryServer'),
    instrumentation: await import('@/instrumentation'),
  }
}

const request = { path: '/x', method: 'GET', headers: {} }
const context = {
  routerKind: 'App Router',
  routePath: '/x',
  routeType: 'route',
  renderSource: undefined,
  revalidateReason: undefined,
} as const

beforeEach(() => {
  mockInit.mockClear()
  mockCaptureRequestError.mockClear()
  sdkLoads.count = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('getServerSentry', () => {
  it('loads and initialises once, with the scrubber, the environment and no ESM loader hooks', async () => {
    enable()
    const { sentry } = await load()
    const [a, b] = await Promise.all([sentry.getServerSentry(), sentry.getServerSentry()])
    const c = await sentry.getServerSentry()
    expect(a).not.toBeNull()
    expect(a).toBe(b)
    expect(a).toBe(c)
    expect(mockInit).toHaveBeenCalledTimes(1)
    const options = mockInit.mock.calls[0][0]
    expect(options).toMatchObject({
      dsn: DSN,
      environment: 'preview',
      sendDefaultPii: false,
      registerEsmLoaderHooks: false,
    })
    const { scrubEvent } = await import('@/lib/sentry-scrubber')
    expect(options.beforeSend).toBe(scrubEvent)
    expect(options).not.toHaveProperty('skipOpenTelemetrySetup')
  })

  it.each([
    ['no DSN', { NEXT_PUBLIC_SENTRY_DSN: '' }],
    ['not the Node.js runtime (edge)', { NEXT_RUNTIME: 'edge' }],
    ['no runtime (unit tests, scripts)', { NEXT_RUNTIME: '' }],
    ['an automated test run (e2e)', { NEXT_PUBLIC_E2E_TEST: 'true' }],
  ])('is null and never loads the SDK with %s', async (_label, env) => {
    enable()
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    const { sentry } = await load()
    expect(sentry.serverSentryEnabled()).toBe(false)
    expect(await sentry.getServerSentry()).toBeNull()
    expect(mockInit).not.toHaveBeenCalled()
    expect(sdkLoads.count).toBe(0)
  })

  it('resolves null on a failed init and does not remember it: the next call tries again', async () => {
    enable()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockInit.mockImplementationOnce(() => {
      throw new Error('init failed')
    })
    const { sentry } = await load()
    expect(await sentry.getServerSentry()).toBeNull()
    expect(error).toHaveBeenCalledWith('[TabMerger] Server Sentry failed to load', expect.any(Error))
    const second = await sentry.getServerSentry()
    expect(second).not.toBeNull()
    expect(mockInit).toHaveBeenCalledTimes(2)
    error.mockRestore()
  })
})

describe('instrumentation.ts', () => {
  it('has no static @sentry/nextjs import (only types)', () => {
    const source = readFileSync(path.resolve(__dirname, '../instrumentation.ts'), 'utf8')
    expect(source).not.toMatch(/^import\s+(?!type\b).*['"]@sentry\/nextjs['"]/m)
    const loader = readFileSync(path.resolve(__dirname, '../lib/sentryServer.ts'), 'utf8')
    expect(loader).not.toMatch(/^import\s+(?!type\b).*['"]@sentry\/nextjs['"]/m)
  })

  it('register() loads and initialises nothing', async () => {
    enable()
    const { instrumentation } = await load()
    await instrumentation.register()
    expect(sdkLoads.count).toBe(0)
    expect(mockInit).not.toHaveBeenCalled()
  })

  it('onRequestError loads the SDK once and forwards every error with its request and context', async () => {
    enable()
    const { instrumentation } = await load()
    const first = new Error('first')
    const second = new Error('second')
    await instrumentation.onRequestError(first, request, context)
    await instrumentation.onRequestError(second, request, context)
    expect(mockInit).toHaveBeenCalledTimes(1)
    expect(mockCaptureRequestError).toHaveBeenNthCalledWith(1, first, request, context)
    expect(mockCaptureRequestError).toHaveBeenNthCalledWith(2, second, request, context)
  })

  it('onRequestError does nothing without a DSN', async () => {
    enable()
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '')
    const { instrumentation } = await load()
    await instrumentation.onRequestError(new Error('x'), request, context)
    expect(sdkLoads.count).toBe(0)
    expect(mockCaptureRequestError).not.toHaveBeenCalled()
  })

  it('onRequestError does nothing in an automated test run', async () => {
    enable()
    vi.stubEnv('NEXT_PUBLIC_E2E_TEST', 'true')
    const { instrumentation } = await load()
    await instrumentation.onRequestError(new Error('x'), request, context)
    expect(sdkLoads.count).toBe(0)
    expect(mockCaptureRequestError).not.toHaveBeenCalled()
  })
})
