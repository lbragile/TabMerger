/**
 * Tests for lib/sharing.ts createSharedBundle() — the fully client-side
 * replacement for the removed POST /api/share-bundle route. Everything
 * (key generation, encryption, and the Supabase insert) happens in the
 * browser; no plaintext or key should ever be observable outside the
 * function's own closures.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetSession = vi.fn()
const mockSingle = vi.fn()
const mockInsert = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
    from: mockFrom,
  }),
}))

function makeFrom() {
  mockInsert.mockImplementation(() => ({
    select: () => ({ single: mockSingle }),
  }))
  mockFrom.mockImplementation(() => ({ insert: mockInsert }))
}

const SECRET_GROUPS = [
  { id: 'g1', name: 'Secret Project', color: 'rgba(0,0,0,1)', windows: [{ tabs: [{ title: 'Secret Tab', url: 'https://secret.example' }] }] },
]

describe('createSharedBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    makeFrom()
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
    mockSingle.mockResolvedValue({ data: { slug: 'slug-1' }, error: null })
  })

  it('throws if no groups are passed', async () => {
    const { createSharedBundle } = await import('@/lib/sharing')
    await expect(createSharedBundle([])).rejects.toThrow('No groups selected')
  })

  it('throws if there is no active session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const { createSharedBundle } = await import('@/lib/sharing')
    await expect(createSharedBundle(SECRET_GROUPS)).rejects.toThrow('Not authenticated')
  })

  it('inserts only a {v:1,iv,ct} ciphertext envelope — no plaintext name/url strings anywhere in it', async () => {
    const { createSharedBundle } = await import('@/lib/sharing')
    await createSharedBundle(SECRET_GROUPS)

    expect(mockFrom).toHaveBeenCalledWith('shared_bundles')
    const insertedRow = mockInsert.mock.calls[0][0]
    expect(insertedRow.user_id).toBe('user-1')
    expect(insertedRow.groups_snapshot).toMatchObject({ v: 1, iv: expect.any(String), ct: expect.any(String) })

    const serialized = JSON.stringify(insertedRow)
    expect(serialized).not.toContain('Secret Tab')
    expect(serialized).not.toContain('secret.example')
    expect(serialized).not.toContain('Secret Project')
  })

  it('generates a fresh key per call (two calls never reuse a data key)', async () => {
    const { createSharedBundle } = await import('@/lib/sharing')
    const url1 = await createSharedBundle(SECRET_GROUPS)
    const url2 = await createSharedBundle(SECRET_GROUPS)

    const key1 = url1.split('#key=')[1]
    const key2 = url2.split('#key=')[1]
    expect(key1).toBeTruthy()
    expect(key2).toBeTruthy()
    expect(key1).not.toBe(key2)
  })

  it('never includes the data key in the row sent to Supabase', async () => {
    const { createSharedBundle } = await import('@/lib/sharing')
    const url = await createSharedBundle(SECRET_GROUPS)
    const key = url.split('#key=')[1]

    const insertedRow = mockInsert.mock.calls[0][0]
    expect(JSON.stringify(insertedRow)).not.toContain(key)
  })

  it('returns a URL with the share slug and a #key= fragment', async () => {
    const { createSharedBundle } = await import('@/lib/sharing')
    const url = await createSharedBundle(SECRET_GROUPS)
    expect(url).toMatch(/\/share\/slug-1#key=.+/)
  })

  it('retries once with a new slug on a unique-violation (23505) and still succeeds', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate' } })
      .mockResolvedValueOnce({ data: { slug: 'slug-2' }, error: null })

    const { createSharedBundle } = await import('@/lib/sharing')
    const url = await createSharedBundle(SECRET_GROUPS)

    expect(mockInsert).toHaveBeenCalledTimes(2)
    expect(url).toMatch(/\/share\/slug-2#key=.+/)
  })

  it('throws with the Supabase error message on a non-collision insert failure', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'db down' } })
    const { createSharedBundle } = await import('@/lib/sharing')
    await expect(createSharedBundle(SECRET_GROUPS)).rejects.toThrow('db down')
  })

  it('decrypts back to the original plaintext with the returned key', async () => {
    const { createSharedBundle } = await import('@/lib/sharing')
    const { importKeyFromBase64, decryptBlob } = await import('@tabmerger/shared')

    const url = await createSharedBundle(SECRET_GROUPS)
    const key = url.split('#key=')[1]
    const dataKey = await importKeyFromBase64(key)
    const insertedRow = mockInsert.mock.calls[0][0]
    const decrypted = await decryptBlob<typeof SECRET_GROUPS>(dataKey, insertedRow.groups_snapshot)

    expect(decrypted[0].windows[0].tabs[0].title).toBe('Secret Tab')
  })
})
