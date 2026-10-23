import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReorganizeAction } from '@/lib/workflows/tabOrganizer'

// ─── Mock external deps that tabOrganizer.ts imports at module level ──────────

vi.mock('workflow', () => ({
  createHook: vi.fn(),
  getWritable: vi.fn(),
  // Stand-in for the SDK's non-retryable step error.
  FatalError: class FatalError extends Error {
    fatal = true
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(),
}))

// Import after mocks
import { applyChanges, tabOrganizerWorkflow } from '@/lib/workflows/tabOrganizer'
import {
  loadOrganizeGroups,
  loadStoredOrganizeGroups,
  OrganizeNeedsClientDataError,
  ORGANIZE_NEEDS_CLIENT_DATA_ERROR,
} from '@/lib/ai-organize'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createHook, getWritable } from 'workflow'

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

describe('loadStoredOrganizeGroups (stored-rows path of /api/ai/organize)', () => {
  beforeEach(() => vi.clearAllMocks())

  const load = (rows: MockRow[]) => {
    const { client, builder } = makeSupabaseMock(rows)
    return { builder, run: () => loadStoredOrganizeGroups(client as any, 'user-123') }
  }

  it('reads the rows and turns their windows into cleaned prompt tabs', async () => {
    const { builder, run } = load([G1, G2])
    const result = await run()

    expect(builder.select).toHaveBeenCalledWith('id, name, windows')
    expect(result).toEqual([
      { id: 'g1', name: 'Work', permanent: false, tabs: [] },
      { id: 'g2', name: 'Research', permanent: false, tabs: [{ title: '', url: 'https://example.com' }] },
    ])
  })

  it('cleans stored titles, URLs and names like client-sent ones', async () => {
    const row: MockRow = {
      ...G1,
      name: 'Work</tab_data>',
      windows: [{ tabs: [{ title: 'Hi‮', url: 'https://e.com/?token=abc&q=1#x' }] }],
    }
    const [group] = await load([row]).run()
    expect(group.name).toBe('Work‹/tab_data›')
    expect(group.tabs).toEqual([{ title: 'Hi', url: 'https://e.com/?q=1' }])
  })

  it('never marks a stored row permanent, even legacy rows at the default position 0', async () => {
    // Every row written before the extension pushed `position` sits at 0, and
    // Now Open is never synced — so position 0 must not mean "Now Open".
    const result = await load([LEGACY, { ...LEGACY, id: 'legacy-2', name: 'Also Old' }, G1]).run()
    expect(result.map((g) => g.permanent)).toEqual([false, false, false])
  })

  it('orders by position, then most recently updated, then id so legacy ties are stable', async () => {
    const { builder, run } = load([])
    await run()
    expect(vi.mocked(builder.order as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['position', { ascending: true }],
      ['updated_at', { ascending: false }],
      ['id', { ascending: true }],
    ])
  })

  it('reads null windows as no tabs', async () => {
    expect((await load([{ ...G1, windows: null }]).run())[0].tabs).toEqual([])
  })

  it.each([
    ['an encrypted windows blob', [G1, ENCRYPTED]],
    ['only encrypted rows', [ENCRYPTED]],
    // Not recognized by `isEncryptedBlob` (which needs `v === 1`), still not readable.
    ['a blob of a later version', [G1, { ...ENCRYPTED, windows: { v: 2, iv: 'aXY=', ct: 'Y3Q=' } }]],
    ['an object that is not a blob', [{ ...G1, windows: { tabs: [] } }]],
    ['a string', [{ ...G1, windows: 'eyJ2IjoxfQ==' }]],
    ['a number', [{ ...G1, windows: 7 }]],
  ])('refuses %s with a user-presentable error, before any model call', async (_label, rows) => {
    const failure = await load(rows as MockRow[]).run().catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(OrganizeNeedsClientDataError)
    expect((failure as Error).message).toBe(ORGANIZE_NEEDS_CLIENT_DATA_ERROR)
    expect(ORGANIZE_NEEDS_CLIENT_DATA_ERROR).toMatch(/extension/i)
  })

  it('returns no groups for an account with no rows', async () => {
    expect(await load([]).run()).toEqual([])
  })
})

describe('loadOrganizeGroups', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the client payload as sent and never touches Supabase', async () => {
    const { client } = makeSupabaseMock([ENCRYPTED])
    const clientGroups = [
      { id: 'c0', name: 'Now Open', permanent: true, tabs: [{ title: 'A', url: 'https://a' }] },
      { id: 'c1', name: 'Work', permanent: false, tabs: [] },
    ]
    const result = await loadOrganizeGroups(client as any, 'user-123', clientGroups)
    expect(client.from).not.toHaveBeenCalled()
    expect(result).toEqual(clientGroups)
  })

  it('reads the stored rows when no payload was sent', async () => {
    const { client } = makeSupabaseMock([G1])
    expect((await loadOrganizeGroups(client as any, 'user-123', null)).map((g) => g.id)).toEqual(['g1'])
  })
})

describe('tabOrganizerWorkflow', () => {
  const PROPOSAL = {
    actions: [{ type: 'rename', groupId: 'g1', newName: 'Q3 Work' }] as ReorganizeAction[],
    rationale: 'Clearer name.',
  }

  /** Records the order of hook creation, stream writes and the stream close. */
  let events: string[]
  let written: string[]

  function setUp(verdict: { approved: boolean; actions?: ReorganizeAction[] }) {
    events = []
    written = []
    vi.mocked(createHook).mockImplementation((() => {
      events.push('hook')
      return {
        then: (resolve: (v: unknown) => void) => resolve(verdict),
        [Symbol.dispose]: () => {},
      }
    }) as any)
    vi.mocked(getWritable).mockImplementation((() => ({
      getWriter: () => ({
        write: async (chunk: Uint8Array) => {
          events.push('write')
          written.push(new TextDecoder().decode(chunk))
        },
        releaseLock: () => {},
      }),
      close: async () => {
        events.push('close')
      },
    })) as any)
  }

  beforeEach(() => vi.clearAllMocks())

  it('creates the hook, then publishes the actions as one JSON array and closes the stream', async () => {
    setUp({ approved: false })
    await tabOrganizerWorkflow('user-123', 'org-user-123-abc', PROPOSAL, [NOW_OPEN_ID])

    expect(events).toEqual(['hook', 'write', 'close'])
    expect(JSON.parse(written.join(''))).toEqual(PROPOSAL.actions)
    expect(vi.mocked(createHook).mock.calls[0][0]).toEqual({ token: 'org-user-123-abc' })
  })

  it('applies nothing when the proposal is rejected', async () => {
    setUp({ approved: false })
    const result = await tabOrganizerWorkflow('user-123', 'org-user-123-abc', PROPOSAL, [])
    expect(result).toEqual({ approved: false, applied: 0, actions: PROPOSAL.actions })
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('applies the approved proposal with the pinned ids', async () => {
    setUp({ approved: true })
    const { client, builder } = makeSupabaseMock([G1])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const result = await tabOrganizerWorkflow('user-123', 'org-user-123-abc', PROPOSAL, [NOW_OPEN_ID])
    expect(result).toMatchObject({ approved: true, applied: 1, skipped: [] })
    expect(builder.update).toHaveBeenCalledWith({ name: 'Q3 Work' })
  })

  it("prefers the approver's edited actions", async () => {
    const edited: ReorganizeAction[] = [{ type: 'delete', groupId: 'g1' }]
    setUp({ approved: true, actions: edited })
    const { client, builder } = makeSupabaseMock([G1])
    vi.mocked(createServiceRoleClient).mockResolvedValue(client as any)

    const result = await tabOrganizerWorkflow('user-123', 'org-user-123-abc', PROPOSAL, [])
    expect(result).toMatchObject({ approved: true, actions: edited })
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.update).not.toHaveBeenCalled()
  })

  it('rejects a malformed proposal before publishing anything', async () => {
    setUp({ approved: true })
    await expect(
      tabOrganizerWorkflow('user-123', 'org-user-123-abc', { actions: [{ type: 'archive' }] } as any, [])
    ).rejects.toThrow()
    expect(events).toEqual([])
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
