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

/**
 * Id of the client's Now Open group. The extension never syncs Now Open, so it is
 * never a `groups` row; the workflow only learns it from the client payload and
 * hands it to applyChanges as a pinned id.
 */
const NOW_OPEN_ID = 'now-open'

/** A row written before the extension pushed `position`: the column default 0. */
const LEGACY: MockRow = { id: 'legacy', name: 'Old Saved', color: '#ff0', position: 0, windows: [] }
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

/** Positions passed to `update({ position })`, in call order. */
function writtenPositions(builder: Record<string, unknown>): number[] {
  return vi
    .mocked(builder.update as ReturnType<typeof vi.fn>)
    .mock.calls.map((c) => (c[0] as { position?: number }).position)
    .filter((p): p is number => p !== undefined)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('fetchUserData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads from Supabase when no client payload is supplied', async () => {
    const { client, builder } = makeSupabaseMock([G1, G2])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const result = await fetchUserData('user-123', null)

    expect(builder.select).toHaveBeenCalledWith('id, name, color, position, windows')
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 'g1', position: 1, permanent: false })
    expect(result[1]).toMatchObject({ id: 'g2', position: 2, permanent: false })
    expect(result[1].windows).toEqual(G2.windows)
  })

  it('never marks a stored row permanent, even legacy rows at the default position 0', async () => {
    // Every row written before the extension pushed `position` sits at 0, and
    // Now Open is never synced — so position 0 must not mean "Now Open".
    const { client } = makeSupabaseMock([
      LEGACY,
      { ...LEGACY, id: 'legacy-2', name: 'Also Old' },
      G1,
    ])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const result = await fetchUserData('user-123', null)

    expect(result.map((g) => g.permanent)).toEqual([false, false, false])
    expect(result[0]).toMatchObject({ id: 'legacy', position: 0 })
  })

  it('orders by position, then most recently updated, then id so legacy ties are stable', async () => {
    const { client, builder } = makeSupabaseMock([])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    await fetchUserData('user-123', null)

    expect(vi.mocked(builder.order as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['position', { ascending: true }],
      ['updated_at', { ascending: false }],
      ['id', { ascending: true }],
    ])
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
    // The client list includes its local Now Open at index 0; index doubles as
    // position, the same rule the extension uses when pushing.
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

  // ── Now Open / pinned-id guards ────────────────────────────────────────────

  it.each([
    ['delete', { type: 'delete', groupId: NOW_OPEN_ID }],
    ['rename', { type: 'rename', groupId: NOW_OPEN_ID, newName: 'Tabs' }],
    ['merge source', { type: 'merge', sourceGroupId: NOW_OPEN_ID, targetGroupId: 'g1' }],
    ['merge target', { type: 'merge', sourceGroupId: 'g1', targetGroupId: NOW_OPEN_ID }],
  ])('skips %s of the pinned Now Open group without writing', async (_label, action) => {
    const { client, builder } = makeSupabaseMock([G1])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const result = await applyChanges('user-123', [action as ReorganizeAction], [NOW_OPEN_ID])

    expect(result.applied).toBe(0)
    expect(result.skipped).toEqual([action])
    expect(builder.update).not.toHaveBeenCalled()
    expect(builder.delete).not.toHaveBeenCalled()
  })

  it('skips a pinned id even if a stored row happens to share it', async () => {
    const { client, builder } = makeSupabaseMock([{ ...G1, id: NOW_OPEN_ID }])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const action: ReorganizeAction = { type: 'delete', groupId: NOW_OPEN_ID }
    const result = await applyChanges('user-123', [action], [NOW_OPEN_ID])

    expect(result.skipped).toEqual([action])
    expect(builder.delete).not.toHaveBeenCalled()
  })

  it.each([
    ['delete', { type: 'delete', groupId: 'ghost' }],
    ['rename', { type: 'rename', groupId: 'ghost', newName: 'X' }],
  ])('skips %s of an id with no stored row instead of counting a no-op as applied', async (_label, action) => {
    const { client, builder } = makeSupabaseMock([G1])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const result = await applyChanges('user-123', [action as ReorganizeAction])

    expect(result.applied).toBe(0)
    expect(result.skipped).toEqual([action])
    expect(builder.update).not.toHaveBeenCalled()
    expect(builder.delete).not.toHaveBeenCalled()
  })

  // ── Legacy position-0 rows are ordinary groups ─────────────────────────────

  it('deletes a legacy position-0 row — it is a saved group, not Now Open', async () => {
    const { client, builder } = makeSupabaseMock([LEGACY, G1])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const result = await applyChanges('user-123', [{ type: 'delete', groupId: 'legacy' }])

    expect(result.applied).toBe(1)
    expect(result.skipped).toHaveLength(0)
    expect(builder.delete).toHaveBeenCalled()
  })

  it('merges a legacy position-0 row away when it is the source', async () => {
    const { client, builder } = makeSupabaseMock([LEGACY, G2])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const action: ReorganizeAction = { type: 'merge', sourceGroupId: 'legacy', targetGroupId: 'g2' }
    const result = await applyChanges('user-123', [action])

    expect(result.applied).toBe(1)
    expect(result.skipped).toHaveLength(0)
    expect(builder.update).toHaveBeenCalledWith({ windows: G2.windows })
    expect(builder.delete).toHaveBeenCalled()
  })

  // ── Reorder positions follow the extension's rule ──────────────────────────

  it('reorder pins Now Open at index 0 and writes stored groups from 1', async () => {
    const { client, builder } = makeSupabaseMock([LEGACY, G1, G2])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const action: ReorganizeAction = { type: 'reorder', groupIds: ['g2', NOW_OPEN_ID, 'legacy', 'g1'] }
    const result = await applyChanges('user-123', [action], [NOW_OPEN_ID])

    expect(result.applied).toBe(1)
    expect(result.skipped).toHaveLength(0)
    // g2=1, legacy=2, g1=3; Now Open takes no slot and position 0 is never written
    expect(writtenPositions(builder)).toEqual([1, 2, 3])
    expect(vi.mocked(builder.eq as ReturnType<typeof vi.fn>).mock.calls).toEqual(
      expect.arrayContaining([['id', 'g2'], ['id', 'legacy'], ['id', 'g1']])
    )
  })

  it('reorder gives an unsynced client group its slot without writing it', async () => {
    const { client, builder } = makeSupabaseMock([G1, G2])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    // Client list: [Now Open, g1, local-only, g2] → g2 must land on its client index 3.
    const action: ReorganizeAction = { type: 'reorder', groupIds: [NOW_OPEN_ID, 'g1', 'local-only', 'g2'] }
    await applyChanges('user-123', [action], [NOW_OPEN_ID])

    expect(writtenPositions(builder)).toEqual([1, 3])
    const eqIds = vi
      .mocked(builder.eq as ReturnType<typeof vi.fn>)
      .mock.calls.filter((c) => c[0] === 'id')
      .map((c) => c[1])
    expect(eqIds).toEqual(['g1', 'g2'])
  })

  it('applies rename and delete of stored groups', async () => {
    const { client, builder } = makeSupabaseMock([G1, G2])
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

  it('skips a second action on a group already deleted earlier in the batch', async () => {
    const { client } = makeSupabaseMock([G1])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const result = await applyChanges('user-123', [
      { type: 'delete', groupId: 'g1' },
      { type: 'rename', groupId: 'g1', newName: 'Gone' },
    ])

    expect(result.applied).toBe(1)
    expect(result.skipped).toEqual([{ type: 'rename', groupId: 'g1', newName: 'Gone' }])
  })

  // ── E2EE writeback guards ──────────────────────────────────────────────────
  // The server has no decryption key, so it must refuse any content-bearing
  // write to an encrypted group rather than clobbering it with plaintext.

  it('skips rename of an encrypted group instead of writing plaintext name', async () => {
    const { client, builder } = makeSupabaseMock([ENCRYPTED])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const action: ReorganizeAction = { type: 'rename', groupId: 'enc1', newName: 'Docs' }
    const result = await applyChanges('user-123', [action], [NOW_OPEN_ID])

    expect(result.applied).toBe(0)
    expect(result.skipped).toEqual([action])
    expect(builder.update).not.toHaveBeenCalled()
  })

  it.each([
    ['source', { type: 'merge', sourceGroupId: 'enc1', targetGroupId: 'g1' }],
    ['target', { type: 'merge', sourceGroupId: 'g1', targetGroupId: 'enc1' }],
  ])('skips merge when the %s group is encrypted', async (_label, action) => {
    const { client, builder } = makeSupabaseMock([G1, ENCRYPTED])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const result = await applyChanges('user-123', [action as ReorganizeAction], [NOW_OPEN_ID])

    expect(result.applied).toBe(0)
    expect(result.skipped).toEqual([action])
    expect(builder.update).not.toHaveBeenCalled()
    expect(builder.delete).not.toHaveBeenCalled()
  })

  it('still applies content-free delete and reorder for encrypted groups', async () => {
    const { client, builder } = makeSupabaseMock([ENCRYPTED])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const result = await applyChanges(
      'user-123',
      [
        { type: 'reorder', groupIds: [NOW_OPEN_ID, 'enc1'] },
        { type: 'delete', groupId: 'enc1' },
      ],
      [NOW_OPEN_ID]
    )

    expect(result.applied).toBe(2)
    expect(result.skipped).toHaveLength(0)
    expect(builder.update).toHaveBeenCalledWith({ position: 1 })
    expect(builder.delete).toHaveBeenCalled()
  })

  it('processes mixed actions, skipping only the guarded ones', async () => {
    const { client } = makeSupabaseMock([G1])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const actions: ReorganizeAction[] = [
      { type: 'delete', groupId: NOW_OPEN_ID }, // skipped
      { type: 'rename', groupId: 'g1', newName: 'Q3 Work' }, // applied
    ]
    const result = await applyChanges('user-123', actions, [NOW_OPEN_ID])

    expect(result.applied).toBe(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].type).toBe('delete')
  })
})
