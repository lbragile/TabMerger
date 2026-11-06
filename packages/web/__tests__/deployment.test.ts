import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clientDeployEnv,
  deployCommitRef,
  deployCommitSha,
  deployEnv,
  deploymentId,
  deployPlatform,
  isHostedDeployment,
  isPreviewDeployment,
  isProductionDeployment,
  normalizeDeployEnv,
} from '@/lib/deployment'

/** Every variable lib/deployment.ts reads, cleared so the developer's shell can't leak in. */
const VARS = [
  'DEPLOY_ENV',
  'NEXT_PUBLIC_DEPLOY_ENV',
  'DEPLOY_PLATFORM',
  'DEPLOY_COMMIT_SHA',
  'DEPLOY_COMMIT_REF',
  'VERCEL',
  'VERCEL_ENV',
  'NEXT_PUBLIC_VERCEL_ENV',
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_GIT_COMMIT_REF',
  'VERCEL_DEPLOYMENT_ID',
]

beforeEach(() => {
  for (const name of VARS) vi.stubEnv(name, '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('deployEnv', () => {
  it('is development when nothing is set (local dev, CI, tests)', () => {
    expect(deployEnv()).toBe('development')
  })

  it.each(['production', 'preview'] as const)('reads DEPLOY_ENV=%s', (env) => {
    vi.stubEnv('DEPLOY_ENV', env)
    expect(deployEnv()).toBe(env)
  })

  it.each(['production', 'preview'] as const)('falls back to VERCEL_ENV=%s (Vercel deploys, unchanged)', (env) => {
    vi.stubEnv('VERCEL_ENV', env)
    expect(deployEnv()).toBe(env)
  })

  it('prefers DEPLOY_ENV over VERCEL_ENV', () => {
    vi.stubEnv('DEPLOY_ENV', 'preview')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(deployEnv()).toBe('preview')
  })

  it('falls back to the build-time NEXT_PUBLIC_DEPLOY_ENV when no runtime value is set', () => {
    vi.stubEnv('NEXT_PUBLIC_DEPLOY_ENV', 'production')
    expect(deployEnv()).toBe('production')
    vi.stubEnv('DEPLOY_ENV', 'preview')
    expect(deployEnv()).toBe('preview')
  })

  it('ignores NEXT_PUBLIC_VERCEL_ENV (next.config derives NEXT_PUBLIC_DEPLOY_ENV instead)', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    expect(deployEnv()).toBe('development')
  })

  it('treats an unknown name as development', () => {
    vi.stubEnv('DEPLOY_ENV', 'staging')
    expect(deployEnv()).toBe('development')
    expect(normalizeDeployEnv(undefined)).toBe('development')
    expect(normalizeDeployEnv('Production')).toBe('development')
  })
})

describe('clientDeployEnv', () => {
  it('reads only the build-time NEXT_PUBLIC_DEPLOY_ENV', () => {
    expect(clientDeployEnv()).toBe('development')
    vi.stubEnv('DEPLOY_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(clientDeployEnv()).toBe('development')
    vi.stubEnv('NEXT_PUBLIC_DEPLOY_ENV', 'preview')
    expect(clientDeployEnv()).toBe('preview')
  })
})

describe('isProductionDeployment', () => {
  it('is true on the production deployment (server: DEPLOY_ENV or VERCEL_ENV)', () => {
    vi.stubEnv('DEPLOY_ENV', 'production')
    expect(isProductionDeployment()).toBe(true)
    vi.stubEnv('DEPLOY_ENV', '')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(isProductionDeployment()).toBe(true)
  })

  it('is true on the production deployment (browser bundle: NEXT_PUBLIC_DEPLOY_ENV)', () => {
    vi.stubEnv('NEXT_PUBLIC_DEPLOY_ENV', 'production')
    expect(isProductionDeployment()).toBe(true)
  })

  it.each(['preview', 'development'])('is false when the deployment is %s', (env) => {
    vi.stubEnv('DEPLOY_ENV', env)
    vi.stubEnv('VERCEL_ENV', env)
    vi.stubEnv('NEXT_PUBLIC_DEPLOY_ENV', env)
    expect(isProductionDeployment()).toBe(false)
  })

  it('is false when no deployment environment is set (local dev, tests)', () => {
    expect(isProductionDeployment()).toBe(false)
  })

  it('does not treat a production build (NODE_ENV) as the production deployment', () => {
    // The preview site is also a production *build*; only the deployment environment decides.
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DEPLOY_ENV', 'preview')
    expect(isProductionDeployment()).toBe(false)
  })
})

describe('isPreviewDeployment', () => {
  it('is true only on the preview deployment', () => {
    expect(isPreviewDeployment()).toBe(false)
    vi.stubEnv('DEPLOY_ENV', 'preview')
    expect(isPreviewDeployment()).toBe(true)
    vi.stubEnv('DEPLOY_ENV', 'production')
    expect(isPreviewDeployment()).toBe(false)
    vi.stubEnv('DEPLOY_ENV', '')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(isPreviewDeployment()).toBe(true)
  })
})

describe('isHostedDeployment', () => {
  it('is false on a developer machine (nothing set)', () => {
    expect(isHostedDeployment()).toBe(false)
  })

  it.each([
    ['DEPLOY_ENV', 'production'],
    ['DEPLOY_ENV', 'preview'],
    // Even "development": a hosted copy set it, and no developer machine needs to.
    ['DEPLOY_ENV', 'development'],
    ['DEPLOY_ENV', 'anything'],
    ['DEPLOY_PLATFORM', 'cloudflare'],
    ['DEPLOY_PLATFORM', 'vercel'],
    ['DEPLOY_PLATFORM', 'unknown-host'],
    ['VERCEL_ENV', 'preview'],
    ['VERCEL_ENV', 'development'],
    ['VERCEL', '1'],
    ['NEXT_PUBLIC_DEPLOY_ENV', 'production'],
    ['NEXT_PUBLIC_DEPLOY_ENV', 'preview'],
  ])('is true when %s=%s', (name, value) => {
    vi.stubEnv(name, value)
    expect(isHostedDeployment()).toBe(true)
  })

  it('is false for the build-time default NEXT_PUBLIC_DEPLOY_ENV=development (every local build)', () => {
    vi.stubEnv('NEXT_PUBLIC_DEPLOY_ENV', 'development')
    expect(isHostedDeployment()).toBe(false)
  })
})

describe('deployCommitSha / deployCommitRef / deploymentId', () => {
  it('are undefined locally', () => {
    expect(deployCommitSha()).toBeUndefined()
    expect(deployCommitRef()).toBeUndefined()
    expect(deploymentId()).toBeUndefined()
  })

  it('fall back to the Vercel system variables', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc1234def')
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'main')
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_x')
    expect(deployCommitSha()).toBe('abc1234def')
    expect(deployCommitRef()).toBe('main')
    expect(deploymentId()).toBe('dpl_x')
  })

  it('prefer the neutral variables', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc1234def')
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'main')
    vi.stubEnv('DEPLOY_COMMIT_SHA', 'fedcba9876')
    vi.stubEnv('DEPLOY_COMMIT_REF', 'beta')
    expect(deployCommitSha()).toBe('fedcba9876')
    expect(deployCommitRef()).toBe('beta')
  })
})

describe('deployPlatform', () => {
  it('is null locally', () => {
    expect(deployPlatform()).toBeNull()
  })

  it('is vercel when VERCEL=1 (Vercel deploys, unchanged)', () => {
    vi.stubEnv('VERCEL', '1')
    expect(deployPlatform()).toBe('vercel')
  })

  it.each(['cloudflare', 'vercel'] as const)('reads DEPLOY_PLATFORM=%s, over VERCEL=1', (platform) => {
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('DEPLOY_PLATFORM', platform)
    expect(deployPlatform()).toBe(platform)
  })

  it('ignores an unknown DEPLOY_PLATFORM (falls back to VERCEL=1, else null)', () => {
    vi.stubEnv('DEPLOY_PLATFORM', 'Cloudflare')
    expect(deployPlatform()).toBeNull()
    vi.stubEnv('VERCEL', '1')
    expect(deployPlatform()).toBe('vercel')
  })
})
