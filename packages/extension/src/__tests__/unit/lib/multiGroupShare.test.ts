/**
 * Feature 63 — Multi-group sharing UI (extension)
 *
 * Tests the contract for createSharedBundle. ALL tests FAIL until the
 * function is implemented in (expected path) @/lib/sharing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
// ponytail: import the function that doesn't exist yet — this is the red phase
import { createSharedBundle } from '@/lib/sharing'
import type { Group } from '@/lib/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: `group-${Math.random().toString(36).slice(2)}`,
    name: 'Test Group',
    color: 'rgba(59,130,246,1)',
    updatedAt: Date.now(),
    windows: [
      {
        id: 1,
        tabs: [
          { id: 1, title: 'GitHub', url: 'https://github.com' },
          { id: 2, title: 'MDN', url: 'https://developer.mozilla.org' },
        ],
        incognito: false,
        focused: false,
      },
    ],
    ...overrides,
  }
}

// ─── Supabase client mock ─────────────────────────────────────────────────────

const mockInsert = vi.fn()
const mockSelect = vi.fn()
const mockSingle = vi.fn()
const mockFrom = vi.fn()
const mockGetSession = vi.fn()

function makeMockSupabase(authenticated = true) {
  // Fluent chain: from().insert().select().single()
  mockSingle.mockResolvedValue({
    data: { slug: 'abc123', id: 'bundle-1' },
    error: null,
  })
  mockSelect.mockReturnValue({ single: mockSingle })
  mockInsert.mockReturnValue({ select: mockSelect })
  mockFrom.mockReturnValue({ insert: mockInsert })
  mockGetSession.mockResolvedValue({
    data: {
      session: authenticated
        ? { user: { id: 'user-1' }, access_token: 'tok' }
        : null,
    },
  })

  return {
    from: mockFrom,
    auth: { getSession: mockGetSession },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createSharedBundle — Feature 63', () => {
  it('posts an encrypted {v,iv,ct} snapshot to the shared_bundles table, never plaintext', async () => {
    const client = makeMockSupabase()
    const g1 = makeGroup({ name: 'Work' })
    const g2 = makeGroup({ name: 'Research' })

    await createSharedBundle([g1.id, g2.id], [g1, g2], client as never)

    expect(mockFrom).toHaveBeenCalledWith('shared_bundles')
    const insertArg = mockInsert.mock.calls[0][0]
    // groups_snapshot is the real column name (see supabase/migrations/009_create_shared_bundles.sql);
    // regression guard for a shipped bug where the extension inserted a nonexistent `groups` key.
    expect(insertArg).not.toHaveProperty('groups')
    // Security regression guard: the extension share path used to insert the plaintext
    // groups array (leaking titles/URLs/notes); it must now match the web app's
    // E2E-encrypted {v:1,iv,ct} shape produced by @tabmerger/shared's encryptBlob.
    expect(insertArg.groups_snapshot).toMatchObject({
      v: 1,
      iv: expect.any(String),
      ct: expect.any(String),
    })
    const serialized = JSON.stringify(insertArg.groups_snapshot)
    expect(serialized).not.toContain('Work')
    expect(serialized).not.toContain('Research')
    expect(serialized).not.toContain('github.com')
    // regression guard: `slug` is `not null unique` with no DB default (see
    // supabase/migrations/009_create_shared_bundles.sql) — must be generated client-side.
    expect(insertArg.slug).toEqual(expect.any(String))
    expect(insertArg.slug.length).toBeGreaterThanOrEqual(8)
    expect(insertArg.slug).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('returns a URL containing the slug and a #key= fragment, matching the web share-link format', async () => {
    const client = makeMockSupabase()
    const g = makeGroup()

    const url = await createSharedBundle([g.id], [g], client as never)

    expect(url).toContain('abc123')
    expect(url).toMatch(/^https?:\/\//)
    expect(url).toMatch(/#key=[A-Za-z0-9+/=]+$/)
  })

  it('rejects if 0 groups are selected', async () => {
    const client = makeMockSupabase()

    await expect(createSharedBundle([], [], client as never)).rejects.toThrow()
  })

  it('rejects if user is unauthenticated (no session)', async () => {
    const client = makeMockSupabase(false)
    const g = makeGroup()

    await expect(createSharedBundle([g.id], [g], client as never)).rejects.toThrow()
    // Ensure we never hit the DB if unauthenticated
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects for free-tier users (no sharing entitlement)', async () => {
    const client = makeMockSupabase()
    const g = makeGroup()

    // Free tier: pass entitlements object indicating no sharing
    await expect(
      createSharedBundle([g.id], [g], client as never, { tier: 'free', sharing: false })
    ).rejects.toThrow(/upgrade|pro|entitlement/i)
  })

  it('does not insert when entitlement check fails', async () => {
    const client = makeMockSupabase()
    const g = makeGroup()

    try {
      await createSharedBundle([g.id], [g], client as never, { tier: 'free', sharing: false })
    } catch {
      // expected
    }
    expect(mockInsert).not.toHaveBeenCalled()
  })
})
