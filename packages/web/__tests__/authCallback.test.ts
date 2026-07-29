/**
 * Tests for GET /api/auth/callback (app/api/auth/callback/route.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockExchangeCodeForSession = vi.fn()
const mockCreateClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

function makeRequest(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers })
}

describe('GET /api/auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateClient.mockResolvedValue({
      auth: { exchangeCodeForSession: mockExchangeCodeForSession },
    })
    vi.stubEnv('NODE_ENV', 'development')
  })

  it('redirects to sign-in with an error when no code is present', async () => {
    const { GET } = await import('@/app/api/auth/callback/route')

    const res = await GET(makeRequest('http://localhost/api/auth/callback'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/auth/sign-in?error=auth_callback_failed')
  })

  it('redirects to sign-in with an error when code exchange fails', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: new Error('invalid code') })
    const { GET } = await import('@/app/api/auth/callback/route')

    const res = await GET(makeRequest('http://localhost/api/auth/callback?code=bad'))
    expect(res.headers.get('location')).toContain('/auth/sign-in?error=auth_callback_failed')
  })

  it('redirects to the default next path on success in dev', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })
    const { GET } = await import('@/app/api/auth/callback/route')

    const res = await GET(makeRequest('http://localhost/api/auth/callback?code=good'))
    expect(res.headers.get('location')).toBe('http://localhost/dashboard')
  })

  it('redirects to a custom next path on success', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })
    const { GET } = await import('@/app/api/auth/callback/route')

    const res = await GET(makeRequest('http://localhost/api/auth/callback?code=good&next=/account'))
    expect(res.headers.get('location')).toBe('http://localhost/account')
  })

  it('uses x-forwarded-host in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockExchangeCodeForSession.mockResolvedValue({ error: null })
    const { GET } = await import('@/app/api/auth/callback/route')

    const res = await GET(
      makeRequest('http://localhost/api/auth/callback?code=good', {
        'x-forwarded-host': 'tabmerger.app',
      })
    )
    expect(res.headers.get('location')).toBe('https://tabmerger.app/dashboard')
  })
})
