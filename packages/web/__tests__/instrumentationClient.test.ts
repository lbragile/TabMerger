import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { init, replayIntegration, getClient } = vi.hoisted(() => ({
  init: vi.fn(),
  replayIntegration: vi.fn(() => ({})),
  getClient: vi.fn(() => undefined),
}))

vi.mock('@sentry/nextjs', () => ({
  init,
  replayIntegration,
  getClient,
  captureRouterTransitionStart: vi.fn(),
}))
// Run the idle callback straight away so the dynamic import and init happen in the test.
vi.mock('@/components/DeferredOnLoad', () => ({ whenPageIdle: (fn: () => void) => fn() }))

/** Loads the client instrumentation fresh under the stubbed env, and waits for Sentry.init. */
async function load(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  vi.stubEnv('NEXT_PUBLIC_E2E_TEST', '')
  vi.resetModules()
  const mod = await import('@/instrumentation-client')
  return mod
}

describe('instrumentation-client Sentry environment', () => {
  beforeEach(() => {
    init.mockClear()
    // Any non-empty value turns Sentry on; init is mocked, so the DSN's shape doesn't matter.
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://example.invalid/1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(['production', 'preview'])('tags events with environment=%s from NEXT_PUBLIC_DEPLOY_ENV', async (env) => {
    await load({ NEXT_PUBLIC_DEPLOY_ENV: env })
    await vi.waitFor(() => expect(init).toHaveBeenCalledTimes(1))
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ environment: env }))
  })

  it('falls back to development and ignores the server-side names', async () => {
    await load({ NEXT_PUBLIC_DEPLOY_ENV: '', VERCEL_ENV: 'production', DEPLOY_ENV: 'production' })
    await vi.waitFor(() => expect(init).toHaveBeenCalledTimes(1))
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ environment: 'development' }))
  })

  it('does not start Sentry without a DSN', async () => {
    await load({ NEXT_PUBLIC_DEPLOY_ENV: 'production', NEXT_PUBLIC_SENTRY_DSN: '' })
    await new Promise((r) => setTimeout(r, 20))
    expect(init).not.toHaveBeenCalled()
  })
})
