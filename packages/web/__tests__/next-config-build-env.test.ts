/**
 * next.config.ts's host-neutral parts: the values written into the bundles at build time
 * (`buildTimeEnv`), the preview noindex header under `DEPLOY_ENV`, and that /changelog no longer
 * depends on file tracing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const VARS = ['DEPLOY_ENV', 'NEXT_PUBLIC_DEPLOY_ENV', 'VERCEL_ENV', 'DEPLOY_COMMIT_SHA', 'DEPLOY_COMMIT_REF']

beforeEach(() => {
  for (const name of VARS) vi.stubEnv(name, '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('buildTimeEnv', () => {
  it('always defines NEXT_PUBLIC_DEPLOY_ENV, development for a local build', async () => {
    const { buildTimeEnv } = await import('../next.config')
    expect(buildTimeEnv()).toEqual({ NEXT_PUBLIC_DEPLOY_ENV: 'development' })
  })

  it("derives it from DEPLOY_ENV, else Vercel's VERCEL_ENV, so a deploy sets one variable", async () => {
    const { buildTimeEnv } = await import('../next.config')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(buildTimeEnv().NEXT_PUBLIC_DEPLOY_ENV).toBe('preview')
    vi.stubEnv('DEPLOY_ENV', 'production')
    expect(buildTimeEnv().NEXT_PUBLIC_DEPLOY_ENV).toBe('production')
    vi.stubEnv('DEPLOY_ENV', 'nonsense')
    vi.stubEnv('VERCEL_ENV', '')
    expect(buildTimeEnv().NEXT_PUBLIC_DEPLOY_ENV).toBe('development')
  })

  it('stamps DEPLOY_COMMIT_SHA / DEPLOY_COMMIT_REF only when set for the build', async () => {
    const { buildTimeEnv } = await import('../next.config')
    expect(buildTimeEnv()).not.toHaveProperty('DEPLOY_COMMIT_SHA')
    expect(buildTimeEnv()).not.toHaveProperty('DEPLOY_COMMIT_REF')
    vi.stubEnv('DEPLOY_COMMIT_SHA', 'abc1234def')
    vi.stubEnv('DEPLOY_COMMIT_REF', 'main')
    expect(buildTimeEnv()).toMatchObject({ DEPLOY_COMMIT_SHA: 'abc1234def', DEPLOY_COMMIT_REF: 'main' })
  })
})

describe('next.config', () => {
  it('sends the preview noindex header for DEPLOY_ENV=preview too', async () => {
    const { previewNoindexHeaders } = await import('../next.config')
    vi.stubEnv('DEPLOY_ENV', 'preview')
    expect(previewNoindexHeaders()).toEqual([{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] }])
    vi.stubEnv('DEPLOY_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(previewNoindexHeaders()).toEqual([])
  })

  it('needs no file tracing for /changelog (its text is compiled in)', async () => {
    const config = (await import('../next.config')).default as { outputFileTracingIncludes?: unknown; env?: Record<string, string> }
    expect(config.outputFileTracingIncludes).toBeUndefined()
    expect(config.env).toHaveProperty('NEXT_PUBLIC_DEPLOY_ENV')
  })
})
