/**
 * Tests for DELETE /api/sessions/[id] (app/api/sessions/[id]/route.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockDeleteEq2 = vi.fn()
const mockCreateClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

function req() {
  return new NextRequest('http://localhost/api/sessions/s1', { method: 'DELETE' })
}
const params = { params: Promise.resolve({ id: 's1' }) }

describe('DELETE /api/sessions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteEq2.mockResolvedValue({ error: null })
    mockCreateClient.mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ eq: mockDeleteEq2 }),
        }),
      }),
    })
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { DELETE } = await import('@/app/api/sessions/[id]/route')
    const res = await DELETE(req(), params)
    expect(res.status).toBe(401)
  })

  it('returns 204 on successful delete', async () => {
    const { DELETE } = await import('@/app/api/sessions/[id]/route')
    const res = await DELETE(req(), params)
    expect(res.status).toBe(204)
  })

  it('returns 500 when the delete fails', async () => {
    mockDeleteEq2.mockResolvedValue({ error: new Error('db down') })
    const { DELETE } = await import('@/app/api/sessions/[id]/route')
    const res = await DELETE(req(), params)
    expect(res.status).toBe(500)
  })
})
