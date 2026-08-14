/**
 * Unit tests for the dev-only POST /api/ai/dev-usage route.
 * Supabase is mocked wholesale — no network or real service-role key involved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockUpsert = vi.fn()
const mockDelete = vi.fn()
const mockDeleteEq = vi.fn()
const mockFrom = vi.fn()
const mockSupabase = { auth: { getUser: mockGetUser }, from: mockFrom }

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(async () => mockSupabase),
}))

import { POST } from '@/app/api/ai/dev-usage/route'

const USER_ID = 'user-uuid-1'
const URL = 'http://localhost/api/ai/dev-usage'

function req(body?: unknown, auth: string | null = 'Bearer jwt-token') {
  return new NextRequest(URL, {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
    body: JSON.stringify(body ?? {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'development')
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
  mockUpsert.mockResolvedValue({ error: null })
  // .delete().eq('user_id', ...).eq('month', ...) — the final .eq resolves.
  mockDeleteEq.mockReturnValue({ eq: mockDeleteEq, error: null })
  mockDelete.mockReturnValue({ eq: mockDeleteEq })
  mockFrom.mockReturnValue({ upsert: mockUpsert, delete: mockDelete })
})

afterEach(() => vi.unstubAllEnvs())

describe('POST /api/ai/dev-usage', () => {
  it('sets the count for the current UTC month', async () => {
    const res = await POST(req({ count: 98 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 98 })

    expect(mockFrom).toHaveBeenCalledWith('ai_usage')
    const [row, opts] = mockUpsert.mock.calls[0]
    expect(row).toEqual({
      user_id: USER_ID,
      month: new Date().toISOString().slice(0, 7),
      credits_used: 98,
    })
    expect(opts).toEqual({ onConflict: 'user_id,month' })
  })

  it('resets to zero via count: 0', async () => {
    const res = await POST(req({ count: 0 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 0 })
    expect(mockUpsert.mock.calls[0][0].credits_used).toBe(0)
  })

  it('reset (count: 0) also clears this month\'s credit purchases', async () => {
    await POST(req({ count: 0 }))
    expect(mockFrom).toHaveBeenCalledWith('ai_usage')
    expect(mockFrom).toHaveBeenCalledWith('ai_credit_purchases')
    expect(mockDelete).toHaveBeenCalledTimes(1)
    expect(mockDeleteEq).toHaveBeenNthCalledWith(1, 'user_id', USER_ID)
    expect(mockDeleteEq).toHaveBeenNthCalledWith(
      2,
      'month',
      new Date().toISOString().slice(0, 7)
    )
  })

  it('a non-zero count leaves credit purchases untouched', async () => {
    await POST(req({ count: 42 }))
    expect(mockFrom).not.toHaveBeenCalledWith('ai_credit_purchases')
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 500 when clearing credit purchases fails', async () => {
    mockDeleteEq.mockReturnValue({ eq: mockDeleteEq, error: { message: 'db down' } })
    const res = await POST(req({ count: 0 }))
    expect(res.status).toBe(500)
  })

  it('ignores a spoofed user_id in the body and uses the token identity', async () => {
    await POST(req({ count: 5, user_id: 'attacker-uuid' }))
    expect(mockUpsert.mock.calls[0][0].user_id).toBe(USER_ID)
  })

  it('returns 404 in production without touching auth', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await POST(req({ count: 98 }))
    expect(res.status).toBe(404)
    expect(mockGetUser).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('returns 401 with no token', async () => {
    const res = await POST(req({ count: 1 }, null))
    expect(res.status).toBe(401)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('returns 401 with an invalid token', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } })
    const res = await POST(req({ count: 1 }))
    expect(res.status).toBe(401)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('returns 400 for a missing or invalid count', async () => {
    for (const body of [{}, { count: -1 }, { count: 'ten' }, { count: 1.5 }]) {
      const res = await POST(req(body))
      expect(res.status).toBe(400)
    }
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('returns 500 when the upsert fails', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'db down' } })
    const res = await POST(req({ count: 3 }))
    expect(res.status).toBe(500)
  })
})
