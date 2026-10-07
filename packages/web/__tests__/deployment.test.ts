import { afterEach, describe, expect, it, vi } from 'vitest'
import { isProductionDeployment } from '@/lib/deployment'

describe('isProductionDeployment', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is true on the production deployment (server: VERCEL_ENV)', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '')
    expect(isProductionDeployment()).toBe(true)
  })

  it('is true on the production deployment (browser bundle: NEXT_PUBLIC_VERCEL_ENV)', () => {
    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    expect(isProductionDeployment()).toBe(true)
  })

  it.each(['preview', 'development'])('is false when the deployment is %s', (env) => {
    vi.stubEnv('VERCEL_ENV', env)
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', env)
    expect(isProductionDeployment()).toBe(false)
  })

  it('is false when no Vercel environment is set (local dev, tests)', () => {
    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '')
    expect(isProductionDeployment()).toBe(false)
  })

  it('does not treat a production build (NODE_ENV) as the production deployment', () => {
    // The preview site is also a production *build*; only the Vercel target decides.
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    expect(isProductionDeployment()).toBe(false)
  })
})
