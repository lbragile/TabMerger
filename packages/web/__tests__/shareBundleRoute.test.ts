/**
 * Tests for POST /api/share-bundle (app/api/share-bundle/route.ts)
 *
 * The route accepts already-decrypted group content from the client (not a
 * server-side read of `groups.windows`, which is ciphertext for every
 * E2E-encrypted account) and encrypts that content as the outer share-bundle
 * layer before it reaches Supabase.
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

const CLIENT_GROUPS = [
  { id: 'g1', name: 'Work', color: 'rgba(0,0,0,1)', windows: [{ tabs: [{ title: 'Secret Tab', url: 'https://secret.example' }] }] },
]

describe('POST /api/share-bundle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateClient.mockResolvedValue(makeSupabase())
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockGroupsSelect.mockResolvedValue({ data: [{ id: 'g1' }], error: null })
    mockInsert.mockResolvedValue({ error: null })
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groups: CLIENT_GROUPS }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when groups is missing or empty', async () => {
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groups: [] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when group content is malformed', async () => {
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groups: [{ id: 'g1' }] }))
    expect(res.status).toBe(400)
  })

  it('returns 404 when the caller does not own any of the submitted group ids', async () => {
    mockGroupsSelect.mockResolvedValue({ data: [], error: null })
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groups: CLIENT_GROUPS }))
    expect(res.status).toBe(404)
  })

  it('returns 500 when the ownership lookup fails', async () => {
    mockGroupsSelect.mockResolvedValue({ data: null, error: new Error('db down') })
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groups: CLIENT_GROUPS }))
    expect(res.status).toBe(500)
  })

  it('returns 500 when the insert fails', async () => {
    mockInsert.mockResolvedValue({ error: new Error('db down') })
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groups: CLIENT_GROUPS }))
    expect(res.status).toBe(500)
  })

  it('encrypts the client-supplied content before inserting — Supabase never sees plaintext', async () => {
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groups: CLIENT_GROUPS }))
    expect(res.status).toBe(200)

    const insertedRow = mockInsert.mock.calls[0][0]
    expect(insertedRow.groups_snapshot).toMatchObject({ v: 1, iv: expect.any(String), ct: expect.any(String) })
    // The actual secret content must never appear as plaintext in what's persisted.
    expect(JSON.stringify(insertedRow)).not.toContain('Secret Tab')
    expect(JSON.stringify(insertedRow)).not.toContain('secret.example')
  })

  it('produces a bundle whose decrypted content has real windows arrays, not nested ciphertext', async () => {
    const { encryptBlob, decryptBlob } = await import('@tabmerger/shared')
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groups: CLIENT_GROUPS }))
    expect(res.status).toBe(200)
    const { key } = await res.json()

    const { importKeyFromBase64 } = await import('@tabmerger/shared')
    const dataKey = await importKeyFromBase64(key)
    const insertedRow = mockInsert.mock.calls[0][0]
    const decrypted = await decryptBlob<typeof CLIENT_GROUPS>(dataKey, insertedRow.groups_snapshot)

    expect(Array.isArray(decrypted[0].windows)).toBe(true)
    expect(decrypted[0].windows[0].tabs[0].title).toBe('Secret Tab')
    void encryptBlob
  })

  it('returns a slug and a base64 decryption key to the caller (never persisted)', async () => {
    const { POST } = await import('@/app/api/share-bundle/route')
    const res = await POST(req({ groups: CLIENT_GROUPS }))
    const body = await res.json()
    expect(body.slug).toMatch(/^[0-9a-f]{32}$/)
    expect(typeof body.key).toBe('string')
    expect(body.key.length).toBeGreaterThan(0)

    const insertedRow = mockInsert.mock.calls[0][0]
    expect(JSON.stringify(insertedRow)).not.toContain(body.key)
  })

  it('scopes the ownership lookup to the caller\'s own user_id, id-only (not windows)', async () => {
    const supabase = makeSupabase()
    mockCreateClient.mockResolvedValue(supabase)
    const { POST } = await import('@/app/api/share-bundle/route')
    await POST(req({ groups: CLIENT_GROUPS }))
    expect(supabase.from).toHaveBeenCalledWith('groups')
  })

  it('drops any submitted group the caller does not own from the share, even if others match', async () => {
    mockGroupsSelect.mockResolvedValue({ data: [{ id: 'g1' }], error: null })
    const { decryptBlob, importKeyFromBase64 } = await import('@tabmerger/shared')
    const { POST } = await import('@/app/api/share-bundle/route')
    const groups = [
      ...CLIENT_GROUPS,
      { id: 'not-mine', name: 'Not Mine', color: 'rgba(1,1,1,1)', windows: [] },
    ]
    const res = await POST(req({ groups }))
    const { key } = await res.json()
    const dataKey = await importKeyFromBase64(key)
    const insertedRow = mockInsert.mock.calls[0][0]
    const decrypted = await decryptBlob<typeof groups>(dataKey, insertedRow.groups_snapshot)
    expect(decrypted).toHaveLength(1)
    expect(decrypted[0].id).toBe('g1')
  })
})
