/**
 * Tests for DELETE /api/sessions/[id] (app/api/sessions/[id]/route.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockDelete = vi.fn()
const mockDeleteEq1 = vi.fn()
const mockDeleteEq2 = vi.fn()
const mockCreateClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

function req() {
  return new NextRequest('http://localhost/api/sessions/s1', { method: 'DELETE' })
}
const paramsFor = (id: unknown) => ({ params: Promise.resolve({ id }) as Promise<{ id: string }> })
const params = paramsFor('s1')

describe('DELETE /api/sessions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteEq2.mockResolvedValue({ error: null })
    mockDeleteEq1.mockReturnValue({ eq: mockDeleteEq2 })
    mockDelete.mockReturnValue({ eq: mockDeleteEq1 })
    mockFrom.mockReturnValue({ delete: mockDelete })
    mockCreateClient.mockResolvedValue({ auth: { getUser: mockGetUser }, from: mockFrom })
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  })

  it('returns 401 when unauthenticated, and deletes nothing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { DELETE } = await import('@/app/api/sessions/[id]/route')
    const res = await DELETE(req(), params)
    expect(res.status).toBe(401)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('returns 204 on successful delete', async () => {
    const { DELETE } = await import('@/app/api/sessions/[id]/route')
    const res = await DELETE(req(), params)
    expect(res.status).toBe(204)
  })

  it("deletes only that id among the caller's own rows", async () => {
    const { DELETE } = await import('@/app/api/sessions/[id]/route')
    await DELETE(req(), params)
    expect(mockFrom).toHaveBeenCalledWith('sessions')
    expect(mockDeleteEq1).toHaveBeenCalledWith('id', 's1')
    expect(mockDeleteEq2).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('returns a generic 500 when the delete fails, keeping the database wording out of the body', async () => {
    const raw = 'new row violates row-level security policy for table "sessions"'
    mockDeleteEq2.mockResolvedValue({ error: { message: raw, code: '42501' } })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { DELETE } = await import('@/app/api/sessions/[id]/route')
    const res = await DELETE(req(), params)
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: 'Delete failed' })
    expect(text).not.toContain(raw)
    expect(text).not.toContain('sessions')
    expect(consoleError).toHaveBeenCalledWith('Session delete error:', expect.objectContaining({ message: raw }))
    consoleError.mockRestore()
  })

  describe('id shape', () => {
    it.each([
      ['empty', ''],
      ['65 characters', 'a'.repeat(65)],
      ['a path', '../groups'],
      ['a slash', 'a/b'],
      ['a backslash', 'a\\b'],
      ['an encoded slash', 'a%2Fb'],
      ['a dot', 'a.b'],
      ['a space', 'a b'],
      ['unicode letters', 'sésame'],
      ['a non-Latin id', '会话'],
      ['an emoji', 'id\u{1F600}'],
      ['a trailing newline', 's1\n'],
      ['a filter operator', 'eq.s1'],
      ['a list', 's1,s2'],
      ['a quote', "s1'--"],
    ])('answers 400 for %s without touching Supabase', async (_label, id) => {
      const { DELETE } = await import('@/app/api/sessions/[id]/route')
      const res = await DELETE(req(), paramsFor(id))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid session id' })
      expect(mockCreateClient).not.toHaveBeenCalled()
      expect(mockGetUser).not.toHaveBeenCalled()
      expect(mockFrom).not.toHaveBeenCalled()
    })

    it.each([[undefined], [null], [['s1']], [{ id: 's1' }], [7]])('answers 400 for the non-string id %j', async (id) => {
      const { DELETE } = await import('@/app/api/sessions/[id]/route')
      const res = await DELETE(req(), paramsFor(id))
      expect(res.status).toBe(400)
      expect(mockCreateClient).not.toHaveBeenCalled()
    })

    it.each([
      ['a short id', 'V1StGXR8_Z'],
      ['a UUID', '3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d'],
      ['one character', 'a'],
      ['64 characters', 'a'.repeat(64)],
      ['dashes and underscores', '-_-'],
    ])('accepts %s and deletes it', async (_label, id) => {
      const { DELETE } = await import('@/app/api/sessions/[id]/route')
      const res = await DELETE(req(), paramsFor(id))
      expect(res.status).toBe(204)
      expect(mockDeleteEq1).toHaveBeenCalledWith('id', id)
      expect(mockDeleteEq2).toHaveBeenCalledWith('user_id', 'user-1')
    })
  })
})
