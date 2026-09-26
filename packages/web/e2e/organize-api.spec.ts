import { test, expect, type APIRequestContext } from '@playwright/test'

/**
 * Auth-guard smoke tests for the AI organize API routes.
 *
 * These tests only require the Next.js server (started by playwright.config.ts
 * webServer). They do NOT need Supabase or the workflow backend because the 401
 * check happens before any of those are touched.
 *
 * Every /api/ai/* route is behind the NEXT_PUBLIC_AI_ENABLED kill switch
 * (`lib/ai-guard.ts`), which runs before auth. The dev server's flag value comes
 * from its own env (.env.local / CI), so it is probed once rather than assumed:
 * flag off → routes 503 `{ error: 'ai_disabled' }`; flag on → the 401 auth guard.
 */

async function probeAiEnabled(request: APIRequestContext): Promise<boolean> {
  const res = await request.post('/api/ai/organize', { data: {} })
  if (res.status() !== 503) return true
  const body = await res.json().catch(() => ({}))
  return body?.error !== 'ai_disabled'
}

let aiEnabled = true

test.beforeAll(async ({ request }) => {
  aiEnabled = await probeAiEnabled(request)
})

test.describe('AI feature flag off — kill switch', () => {
  test.beforeEach(() => {
    test.skip(aiEnabled, 'NEXT_PUBLIC_AI_ENABLED is "true" on this server')
  })

  for (const [method, path, data] of [
    ['POST', '/api/ai/organize', {}],
    ['GET', '/api/ai/organize?runId=fake-run-id', undefined],
    ['POST', '/api/ai/organize/approve', { token: 'fake', approved: true }],
    ['POST', '/api/ai/group-tabs', { tabs: [] }],
    ['POST', '/api/ai/name-group', { tabs: [] }],
    ['POST', '/api/ai/tab-summary', { tab: {} }],
    ['POST', '/api/ai/suggest-sessions', { groups: [] }],
    ['POST', '/api/ai/dev-usage', { count: 0 }],
  ] as const) {
    test(`${method} ${path} returns 503 ai_disabled`, async ({ request }) => {
      const res =
        method === 'GET'
          ? await request.get(path)
          : await request.post(path, { data, headers: { Authorization: 'Bearer fake' } })
      expect(res.status()).toBe(503)
      expect(await res.json()).toEqual({ error: 'ai_disabled' })
    })
  }
})

test.describe('AI feature flag on — auth guards', () => {
  test.beforeEach(() => {
    test.skip(!aiEnabled, 'NEXT_PUBLIC_AI_ENABLED is off on this server')
  })

  test.describe('POST /api/ai/organize — auth guard', () => {
    test('returns 401 when no Authorization header is sent', async ({ request }) => {
      const res = await request.post('/api/ai/organize', { data: {} })
      expect(res.status()).toBe(401)
      const body = await res.json()
      expect(body).toHaveProperty('error')
    })

    test('returns 401 for a malformed Bearer token (empty string)', async ({ request }) => {
      // "Bearer " with no token → token becomes empty string → falsy
      const res = await request.post('/api/ai/organize', {
        data: {},
        headers: { Authorization: 'Bearer ' },
      })
      expect(res.status()).toBe(401)
    })
  })

  test.describe('GET /api/ai/organize — auth guard', () => {
    test('returns 401 when no Authorization header is sent', async ({ request }) => {
      const res = await request.get('/api/ai/organize?runId=fake-run-id')
      expect(res.status()).toBe(401)
      const body = await res.json()
      expect(body).toHaveProperty('error')
    })
  })

  test.describe('POST /api/ai/organize/approve — auth guard', () => {
    test('returns 401 when no Authorization header is sent', async ({ request }) => {
      const res = await request.post('/api/ai/organize/approve', {
        data: { token: 'fake', approved: true },
      })
      expect(res.status()).toBe(401)
      const body = await res.json()
      expect(body).toHaveProperty('error')
    })
  })
})
