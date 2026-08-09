import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReorganizeAction } from '@/lib/workflows/tabOrganizer'

// ─── Mock external deps that tabOrganizer.ts imports at module level ──────────

vi.mock('workflow', () => ({
  createHook: vi.fn(),
  getWritable: vi.fn(),
}))

vi.mock('@workflow/ai/agent', () => ({
  DurableAgent: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(),
}))

// Import after mocks
import { applyChanges, fetchUserData, type ClientGroup } from '@/lib/workflows/tabOrganizer'
import { createServiceRoleClient } from '@/lib/supabase/server'

// ─── Supabase mock builder ────────────────────────────────────────────────────
//
// Key design: `client` is NOT thenable (no .then property), so Promise.resolve(client)
// does not unwrap it. Only the returned `builder` is thenable, consumed once per await.
//
// ponytail: single shared builder — each `from()` call returns the same builder,
//           and `idx` advances each time the builder is awaited.

type MockRow = {
  id: string
  name: string
  color: string
  position: number
  windows: unknown
}

interface MockBundle {
  client: Record<string, unknown>
  builder: Record<string, unknown>
}

function makeSupabaseMock(fetchRows: MockRow[]): MockBundle {
  let idx = 0

  // All awaits after the initial fetch return success (no error)
  const getResponse = () => {
    if (idx === 0) {
      idx++
      return { data: fetchRows, error: null }
    }
    idx++
    return { data: null as null, error: null }
  }

  // Builder IS thenable — each await consumes the next response
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn().mockReturnValue(builder)
  builder.update = vi.fn().mockReturnValue(builder)
  builder.delete = vi.fn().mockReturnValue(builder)
  builder.eq = vi.fn().mockReturnValue(builder)
  builder.order = vi.fn().mockReturnValue(builder)
  builder.single = vi.fn().mockReturnValue(builder)

  Object.defineProperty(builder, 'then', {
    get() {
      const r = getResponse()
      return (resolve: (v: typeof r) => void) => Promise.resolve(r).then(resolve)
    },
    configurable: true,
    enumerable: false,
  })

  // Client is NOT thenable so Promise.resolve(client) won't unwrap it
  const client: Record<string, unknown> = {
    from: vi.fn().mockReturnValue(builder),
  }

  return { client, builder }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW_OPEN: MockRow = { id: 'now-open', name: 'Now Open', color: '#fff', position: 0, windows: [] }
const G1: MockRow = { id: 'g1', name: 'Work', color: '#f00', position: 1, windows: [] }
const G2: MockRow = {
  id: 'g2',
  name: 'Research',
  color: '#0f0',
  position: 2,
  windows: [{ id: 1, tabs: [{ url: 'https://example.com' }] }],
}

/** A group whose content is client-side ciphertext — the server can never read it. */
const ENCRYPTED: MockRow = {
  id: 'enc1',
  name: '', // encrypted rows store '' here; the real name lives inside the blob
  color: '#00f',
  position: 3,
  windows: { v: 1, iv: 'aXY=', ct: 'Y3Q=' },
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('fetchUserData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads from Supabase when no client payload is supplied', async () => {
    const { client, builder } = makeSupabaseMock([NOW_OPEN, G2])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const result = await fetchUserData('user-123', null)

    expect(builder.select).toHaveBeenCalledWith('id, name, color, position, windows')
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 'now-open', position: 0, permanent: true })
    expect(result[1]).toMatchObject({ id: 'g2', position: 2, permanent: false })
    expect(result[1].windows).toEqual(G2.windows)
  })

  it('uses the client payload verbatim and never touches Supabase', async () => {
    const { client } = makeSupabaseMock([])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const clientGroups: ClientGroup[] = [
      { id: 'c0', name: 'Now Open', tabs: [{ url: 'https://a' }] },
      { id: 'c1', name: 'Work', tabs: [{ url: 'https://b' }] },
    ]
    const result = await fetchUserData('user-123', clientGroups)

    expect(client.from).not.toHaveBeenCalled()
    // index doubles as position; index 0 is the permanent "Now Open" group
    expect(result[0]).toMatchObject({ id: 'c0', position: 0, permanent: true })
    expect(result[1]).toMatchObject({ id: 'c1', position: 1, permanent: false })
    expect(result[1].windows).toEqual([{ tabs: clientGroups[1].tabs }])
  })

  it('honours an explicit `permanent` flag over the index-0 default', async () => {
    const { client } = makeSupabaseMock([])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const result = await fetchUserData('user-123', [
      { id: 'c0', name: 'Work', tabs: [], permanent: false },
      { id: 'c1', name: 'Now Open', tabs: [], permanent: true },
    ])

    expect(result[0].permanent).toBe(false)
    expect(result[1].permanent).toBe(true)
  })

  it('falls back to an empty windows array for null DB windows', async () => {
    const { client } = makeSupabaseMock([{ ...G1, windows: null }])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const result = await fetchUserData('user-123', null)
    expect(result[0].windows).toEqual([])
  })
})

describe('applyChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips delete of the position-0 (permanent) group', async () => {
    const { client, builder } = makeSupabaseMock([NOW_OPEN])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const action: ReorganizeAction = { type: 'delete', groupId: 'now-open' }
    const result = await applyChanges('user-123', [action])

    expect(result.applied).toBe(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toEqual(action)
    // Supabase delete was never called
    expect(builder.delete).not.toHaveBeenCalled()
  })

  it('skips merge when Now Open (position 0) is the source', async () => {
    const { client, builder } = makeSupabaseMock([NOW_OPEN, G1])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const action: ReorganizeAction = { type: 'merge', sourceGroupId: 'now-open', targetGroupId: 'g1' }
    const result = await applyChanges('user-123', [action])

    expect(result.applied).toBe(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toEqual(action)
    // No merge update was applied
    expect(builder.update).not.toHaveBeenCalled()
  })

  it('allows merge when Now Open is the TARGET (not the source)', async () => {
    const { client } = makeSupabaseMock([NOW_OPEN, G2])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    // g2 → now-open: g2 is not permanent, so this is allowed
    const action: ReorganizeAction = { type: 'merge', sourceGroupId: 'g2', targetGroupId: 'now-open' }
    const result = await applyChanges('user-123', [action])

    expect(result.skipped).toHaveLength(0)
    expect(result.applied).toBe(1)
  })

  it('reorder skips the permanent group in the position loop — position 0 is never written', async () => {
    const { client, builder } = makeSupabaseMock([NOW_OPEN, G1, G2])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const action: ReorganizeAction = { type: 'reorder', groupIds: ['now-open', 'g1', 'g2'] }
    const result = await applyChanges('user-123', [action])

    // Reorder action itself counts as applied (not skipped)
    expect(result.applied).toBe(1)
    expect(result.skipped).toHaveLength(0)

    // update() was called for g1 (pos=1) and g2 (pos=2), but NOT for now-open
    const updateCalls = vi.mocked(builder.update as ReturnType<typeof vi.fn>).mock.calls
    const writtenPositions = updateCalls
      .map((c) => (c[0] as { position?: number }).position)
      .filter((p) => p !== undefined)

    expect(writtenPositions).toContain(1)
    expect(writtenPositions).toContain(2)
    // position 0 is never explicitly written — now-open was skipped in the loop
    expect(writtenPositions).not.toContain(0)
  })

  it('applies rename and delete of non-permanent groups', async () => {
    const { client, builder } = makeSupabaseMock([NOW_OPEN, G1, G2])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const actions: ReorganizeAction[] = [
      { type: 'rename', groupId: 'g1', newName: 'Dev Work' },
      { type: 'delete', groupId: 'g2' },
    ]
    const result = await applyChanges('user-123', actions)

    expect(result.applied).toBe(2)
    expect(result.skipped).toHaveLength(0)
    expect(builder.update).toHaveBeenCalledWith({ name: 'Dev Work' })
    expect(builder.delete).toHaveBeenCalled()
  })

  // ── E2EE writeback guards ──────────────────────────────────────────────────
  // The server has no decryption key, so it must refuse any content-bearing
  // write to an encrypted group rather than clobbering it with plaintext.

  it('skips rename of an encrypted group instead of writing plaintext name', async () => {
    const { client, builder } = makeSupabaseMock([NOW_OPEN, ENCRYPTED])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const action: ReorganizeAction = { type: 'rename', groupId: 'enc1', newName: 'Docs' }
    const result = await applyChanges('user-123', [action])

    expect(result.applied).toBe(0)
    expect(result.skipped).toEqual([action])
    expect(builder.update).not.toHaveBeenCalled()
  })

  it.each([
    ['source', { type: 'merge', sourceGroupId: 'enc1', targetGroupId: 'g1' }],
    ['target', { type: 'merge', sourceGroupId: 'g1', targetGroupId: 'enc1' }],
  ])('skips merge when the %s group is encrypted', async (_label, action) => {
    const { client, builder } = makeSupabaseMock([NOW_OPEN, G1, ENCRYPTED])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const result = await applyChanges('user-123', [action as ReorganizeAction])

    expect(result.applied).toBe(0)
    expect(result.skipped).toEqual([action])
    expect(builder.update).not.toHaveBeenCalled()
    expect(builder.delete).not.toHaveBeenCalled()
  })

  it('still applies content-free delete and reorder for encrypted groups', async () => {
    const { client, builder } = makeSupabaseMock([NOW_OPEN, ENCRYPTED])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const result = await applyChanges('user-123', [
      { type: 'reorder', groupIds: ['now-open', 'enc1'] },
      { type: 'delete', groupId: 'enc1' },
    ])

    expect(result.applied).toBe(2)
    expect(result.skipped).toHaveLength(0)
    expect(builder.update).toHaveBeenCalledWith({ position: 1 })
    expect(builder.delete).toHaveBeenCalled()
  })

  it('processes mixed actions, skipping only the guarded ones', async () => {
    const { client } = makeSupabaseMock([NOW_OPEN, G1])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const actions: ReorganizeAction[] = [
      { type: 'delete', groupId: 'now-open' }, // skipped
      { type: 'rename', groupId: 'g1', newName: 'Q3 Work' }, // applied
    ]
    const result = await applyChanges('user-123', actions)

    expect(result.applied).toBe(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].type).toBe('delete')
  })
})
