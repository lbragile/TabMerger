/**
 * GET /api/health (app/api/health/route.ts + lib/health.ts): the public liveness JSON, the
 * cached Supabase check, and that nothing secret is in the answer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET } from '@/app/api/health/route'
import { _resetHealthCacheForTests, checkSupabase, deploymentCommit, SUPABASE_CHECK_TTL_MS } from '@/lib/health'

const fetchMock = vi.fn()

beforeEach(() => {
  _resetHealthCacheForTests()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'ABCDEF0123456789abcdef0123456789abcdef01')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-should-never-appear')
  vi.stubEnv('GA_API_SECRET', 'ga-secret-should-never-appear')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('GET /api/health', () => {
  it('answers 200 with ok, the short commit, the environment, the time and the Supabase status', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({
      ok: true,
      commit: 'abcdef0',
      environment: 'production',
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      supabase: 'ok',
    })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://project.supabase.test/auth/v1/health')
    expect(init.headers).toEqual({ apikey: 'sb_publishable_test' })
  })

  it('never contains a secret or the key', async () => {
    const text = await (await GET()).text()
    expect(text).not.toContain('should-never-appear')
    expect(text).not.toContain('sb_publishable_test')
  })

  it('answers 503 when Supabase is configured but down (error status or a throw)', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ ok: false, supabase: 'down' })

    _resetHealthCacheForTests()
    fetchMock.mockRejectedValue(new Error('timeout'))
    expect((await GET()).status).toBe(503)
  })

  it('stays ok and skips the check when Supabase is not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, supabase: 'unconfigured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('checkSupabase', () => {
  it('reuses one answer for the TTL, then asks again', async () => {
    await checkSupabase(1_000)
    await checkSupabase(1_000 + SUPABASE_CHECK_TTL_MS - 1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await checkSupabase(1_000 + SUPABASE_CHECK_TTL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('deploymentCommit', () => {
  it.each([
    ['', null],
    ['not-a-sha<script>', null],
    ['abc1234', 'abc1234'],
  ])('%j -> %j', (sha, expected) => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', sha)
    expect(deploymentCommit()).toBe(expected)
  })
})
