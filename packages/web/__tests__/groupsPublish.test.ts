/**
 * Tests for POST/DELETE /api/groups/[id]/publish (app/api/groups/[id]/publish/route.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockSingle = vi.fn()
const mockUpdate = vi.fn()
const mockCreateClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

function makeSupabase() {
  const eqChain = { eq: vi.fn().mockReturnThis(), single: mockSingle }
  return {
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      if (table === 'subscriptions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: mockSingle,
        }
      }
      return { update: mockUpdate.mockReturnValue(eqChain) }
    }),
  }
}

function req() {
  return new NextRequest('http://localhost/api/groups/g1/publish', { method: 'POST' })
}
const params = { params: Promise.resolve({ id: 'g1' }) }

describe('POST/DELETE /api/groups/[id]/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateClient.mockResolvedValue(makeSupabase())
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockSingle.mockResolvedValue({ data: { tier: 'pro' } })
  })

  it('POST returns 403 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import('@/app/api/groups/[id]/publish/route')
    const res = await POST(req(), params)
    expect(res.status).toBe(403)
  })

  it('POST returns 403 for a free-tier user', async () => {
    mockSingle.mockResolvedValue({ data: { tier: 'free' } })
    const { POST } = await import('@/app/api/groups/[id]/publish/route')
    const res = await POST(req(), params)
    expect(res.status).toBe(403)
  })

  it('POST returns 403 when no subscription row exists', async () => {
    mockSingle.mockResolvedValue({ data: null })
    const { POST } = await import('@/app/api/groups/[id]/publish/route')
    const res = await POST(req(), params)
    expect(res.status).toBe(403)
  })

  it('POST publishes a group and returns a slug for a pro user', async () => {
    const eqChain = { eq: vi.fn().mockReturnThis() }
    mockUpdate.mockReturnValue(eqChain)
    const { POST } = await import('@/app/api/groups/[id]/publish/route')
    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.slug).toMatch(/^[0-9a-f]{32}$/)
  })

  it('POST works for pro_ai tier too', async () => {
    mockSingle.mockResolvedValue({ data: { tier: 'pro_ai' } })
    mockUpdate.mockReturnValue({ eq: vi.fn().mockReturnThis() })
    const { POST } = await import('@/app/api/groups/[id]/publish/route')
    const res = await POST(req(), params)
    expect(res.status).toBe(200)
  })

  it('POST returns 500 when the update fails', async () => {
    mockUpdate.mockReturnValue({
      eq: vi.fn().mockReturnThis(),
    })
    // Make the last eq() resolve with an error by overriding the chain
    const supabase = await mockCreateClient()
    supabase.from = vi.fn((table: string) => {
      if (table === 'subscriptions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: mockSingle,
        }
      }
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: new Error('db down') }),
          }),
        }),
      }
    })
    mockCreateClient.mockResolvedValue(supabase)

    const { POST } = await import('@/app/api/groups/[id]/publish/route')
    const res = await POST(req(), params)
    expect(res.status).toBe(500)
  })

  it('DELETE returns 403 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { DELETE } = await import('@/app/api/groups/[id]/publish/route')
    const res = await DELETE(req(), params)
    expect(res.status).toBe(403)
  })

  it('DELETE unpublishes a group for a pro user', async () => {
    mockUpdate.mockReturnValue({ eq: vi.fn().mockReturnThis() })
    const { DELETE } = await import('@/app/api/groups/[id]/publish/route')
    const res = await DELETE(req(), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})
