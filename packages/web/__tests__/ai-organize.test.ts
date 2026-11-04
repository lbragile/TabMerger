/**
 * The groups `/api/ai/organize` sends to the model (lib/ai-organize.ts): the client payload as
 * sent, or the user's stored rows, refusing rows that are not readable plaintext.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  loadOrganizeGroups,
  loadStoredOrganizeGroups,
  OrganizeNeedsClientDataError,
  ORGANIZE_NEEDS_CLIENT_DATA_ERROR,
} from '@/lib/ai-organize'

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
