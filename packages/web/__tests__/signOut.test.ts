/**
 * Tests for POST /api/auth/sign-out (app/api/auth/sign-out/route.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockSignOut = vi.fn()
const mockCreateClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

describe('POST /api/auth/sign-out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateClient.mockResolvedValue({ auth: { signOut: mockSignOut } })
  })

  it('signs the user out and redirects to sign-in', async () => {
    const { POST } = await import('@/app/api/auth/sign-out/route')
    const res = await POST(new NextRequest('http://localhost/api/auth/sign-out', { method: 'POST' }))
    expect(mockSignOut).toHaveBeenCalledOnce()
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost/auth/sign-in')
  })
})
