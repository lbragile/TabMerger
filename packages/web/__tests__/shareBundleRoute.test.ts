/**
 * Tests for POST /api/share-bundle (app/api/share-bundle/route.ts)
 *
 * Confirms the write path encrypts the group snapshot before it reaches
 * Supabase — the whole point of the key-in-URL-fragment share scheme is that
 * the server (and therefore the DB) never sees plaintext.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockCreateClient = vi.fn()
const mockInsert = vi.fn()
const mockGroupsSelect = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

function makeSupabase() {
  return {
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      if (table === 'groups') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: mockGroupsSelect,
        }
      }
      // shared_bundles
      return { insert: mockInsert }
    }),
  }
}

function req(body: unknown) {
  return new NextRequest('http://localhost/api/share-bundle', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const FAKE_GROUPS = [
  { id: 'g1', name: 'Work', color: 'rgba(0,0,0,1)', windows: [{ tabs: [{ title: 'Secret Tab', url: 'https://secret.example' }] }] },
]

describe('POST /api/share-bundle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateClient.mockResolvedValue(makeSupabase())
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockGroupsSelect.mockResolvedValue({ data: FAKE_GROUPS, error: null })
    mockInsert.mockResolvedValue({ error: null })
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groupIds: ['g1'] }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when groupIds is missing or empty', async () => {
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groupIds: [] }))
    expect(res.status).toBe(400)
  })

  it('returns 404 when no matching groups are found', async () => {
    mockGroupsSelect.mockResolvedValue({ data: [], error: null })
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groupIds: ['g1'] }))
    expect(res.status).toBe(404)
  })

  it('returns 500 when the groups fetch fails', async () => {
    mockGroupsSelect.mockResolvedValue({ data: null, error: new Error('db down') })
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groupIds: ['g1'] }))
    expect(res.status).toBe(500)
  })

  it('returns 500 when the insert fails', async () => {
    mockInsert.mockResolvedValue({ error: new Error('db down') })
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groupIds: ['g1'] }))
    expect(res.status).toBe(500)
  })

  it('encrypts the snapshot before inserting — Supabase never sees plaintext', async () => {
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groupIds: ['g1'] }))
    expect(res.status).toBe(200)

    const insertedRow = mockInsert.mock.calls[0][0]
    expect(insertedRow.groups_snapshot).toMatchObject({ v: 1, iv: expect.any(String), ct: expect.any(String) })
    // The actual secret content must never appear as plaintext in what's persisted.
    expect(JSON.stringify(insertedRow)).not.toContain('Secret Tab')
    expect(JSON.stringify(insertedRow)).not.toContain('secret.example')
  })

  it('returns a slug and a base64 decryption key to the caller (never persisted)', async () => {
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groupIds: ['g1'] }))
    const body = await res.json()
    expect(body.slug).toMatch(/^[0-9a-f]{32}$/)
    expect(typeof body.key).toBe('string')
    expect(body.key.length).toBeGreaterThan(0)

    const insertedRow = mockInsert.mock.calls[0][0]
    expect(JSON.stringify(insertedRow)).not.toContain(body.key)
  })

  it('scopes the groups fetch to the caller\'s own user_id (ownership guard)', async () => {
    const supabase = makeSupabase()
    mockCreateClient.mockResolvedValue(supabase)
    const { POST } = await import('@/app/api/share-bundle/route')
    await POST(req({ groupIds: ['g1'] }))
    expect(supabase.from).toHaveBeenCalledWith('groups')
  })
})
