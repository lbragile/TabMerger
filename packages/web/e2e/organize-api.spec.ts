import { test, expect } from '@playwright/test'

/**
 * Auth-guard smoke tests for the AI organize API routes.
 *
 * These tests only require the Next.js server (started by playwright.config.ts
 * webServer). They do NOT need Supabase or the workflow backend because the 401
 * check happens before any of those are touched.
 */

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
