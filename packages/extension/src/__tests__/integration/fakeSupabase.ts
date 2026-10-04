/**
 * Test-only controllable fake of the Supabase client surface that `syncEngine.ts` touches
 * (groups upsert/select/delete, auth.getSession, realtime channel). Used by
 * `syncRaces.integration.test.ts` via `vi.mock('@/lib/supabase', ...)` so the REAL localDb /
 * IndexedDB and the REAL syncEngine run, with only the network edge faked.
 *
 * State lives on `globalThis` so it survives `vi.resetModules()` (needed to simulate a second JS
 * context or a worker restart against the same remote).
 */

export interface RemoteRow extends Record<string, unknown> {
  id: string
  user_id: string
}

interface Gate {
  entered: Promise<void>
  release: () => void
}

type GateName = 'upsert' | 'select'

/** One request body sent to the fake server, whatever the table. */
export interface FakeWrite {
  table: string
  op: 'upsert' | 'insert' | 'update'
  body: Record<string, unknown>
}

interface FakeRemoteState {
  rows: Map<string, RemoteRow>
  /** EVERY write request body, in order, for every table (the "what left the device" log). */
  writes: FakeWrite[]
  upserts: RemoteRow[]
  /** Column patches sent through `.update(patch).eq('id', …)`, in order. */
  updates: Array<{ id: string; patch: Record<string, unknown> }>
  deleteCalls: string[][]
  /** Server clock for the BEFORE UPDATE trigger (migration 001): every update stamps a new updated_at. */
  clock: number
  /** Migration 020: a position-only update leaves updated_at unchanged. */
  trigger020: boolean
  failInsert: boolean
  /** The keyset cursor (`id > cursor`) of every full-table page requested; null = first page. */
  selects: Array<string | null>
  /** Fail every page once `selects` holds this many requests (null = never); set relative to now. */
  failAfterPages: number | null
  /** One-shot hook run right after request number `page` (absolute index in `selects`) was served. */
  afterPage: { page: number; run: () => void } | null
  failDelete: boolean
  /** Who the client is signed in as; null = signed out (requests go out as anon and RLS shows no rows). */
  sessionUserId: string | null
  /** Server response cap (PostgREST `max_rows`): a page never holds more rows than this, whatever `limit` asked. */
  maxRows: number
  /** The single-row probe (`maybeSingle`) fails like an offline request. */
  failProbe: boolean
  holds: Partial<Record<GateName, { signalEntered: () => void; released: Promise<void> }>>
  realtimeCb: ((payload: { eventType: string; new?: unknown; old?: unknown }) => Promise<void>) | null
}

const KEY = '__tmFakeRemote'
const g = globalThis as unknown as Record<string, FakeRemoteState | undefined>

function state(): FakeRemoteState {
  if (!g[KEY]) {
    g[KEY] = { rows: new Map(), writes: [], upserts: [], updates: [], deleteCalls: [], failDelete: false, clock: Date.UTC(2030, 0, 1), trigger020: false, failInsert: false, selects: [], failAfterPages: null, afterPage: null, sessionUserId: 'user-1', maxRows: Infinity, failProbe: false, holds: {}, realtimeCb: null }
  }
  return g[KEY]!
}

export const fakeRemote = {
  get rows() {
    return state().rows
  },
  get upserts() {
    return state().upserts
  },
  get writes() {
    return state().writes
  },
  get updates() {
    return state().updates
  },
  get deleteCalls() {
    return state().deleteCalls
  },
  get selects() {
    return state().selects
  },
  set failAfterPages(v: number | null) {
    state().failAfterPages = v === null ? null : state().selects.length + v
  },
  /** Runs `run` once, right after the next pull answered its page number `page` (1-based): a server-side change mid-pull. */
  afterPage(page: number, run: () => void) {
    state().afterPage = { page: state().selects.length + page, run }
  },
  set failInsert(v: boolean) {
    state().failInsert = v
  },
  set trigger020(v: boolean) {
    state().trigger020 = v
  },
  /** Server-side edit by "another device": stamps a fresh updated_at like the trigger does. */
  serverEdit(id: string, patch: Record<string, unknown>) {
    const row = state().rows.get(id)
    if (row) state().rows.set(id, { ...row, ...patch, updated_at: nextStamp() })
  },
  set failDelete(v: boolean) {
    state().failDelete = v
  },
  /** Sign the client in as `userId`, or out with null (later requests are anon: RLS returns no rows, rejects writes). */
  set sessionUserId(v: string | null) {
    state().sessionUserId = v
  },
  set maxRows(v: number) {
    state().maxRows = v
  },
  set failProbe(v: boolean) {
    state().failProbe = v
  },
  get realtimeCb() {
    return state().realtimeCb
  },
  reset() {
    const s = state()
    s.rows.clear()
    s.writes.length = 0
    s.upserts.length = 0
    s.updates.length = 0
    s.deleteCalls.length = 0
    s.failDelete = false
    s.trigger020 = false
    s.failInsert = false
    s.selects.length = 0
    s.failAfterPages = null
    s.afterPage = null
    s.sessionUserId = 'user-1'
    s.maxRows = Infinity
    s.failProbe = false
    s.clock = Date.UTC(2030, 0, 1)
    s.holds = {}
    s.realtimeCb = null
  },
  /** One-shot: the next `name` request blocks (before taking effect) until `release()`. */
  hold(name: GateName): Gate {
    let signalEntered!: () => void
    let release!: () => void
    const entered = new Promise<void>((r) => (signalEntered = r))
    const released = new Promise<void>((r) => (release = r))
    state().holds[name] = { signalEntered, released }
    return { entered, release }
  },
}

async function maybeGate(name: GateName): Promise<void> {
  const h = state().holds[name]
  if (!h) return
  delete state().holds[name]
  h.signalEntered()
  await h.released
}

const OFFLINE = { message: 'Failed to fetch' }

/** A new server timestamp (strictly increasing), formatted like the stored column. */
function nextStamp(): string {
  const s = state()
  s.clock += 1000
  return new Date(s.clock).toISOString()
}

type Result = { data?: unknown; error: unknown }

/** Thenable query result that accepts (and ignores) `.abortSignal(signal)`, like a supabase-js builder. */
function request<T extends Result>(run: () => Promise<T>) {
  const r = {
    abortSignal: (_signal: AbortSignal) => r,
    then: (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) => run().then(resolve, reject),
  }
  return r
}

/** A write result that also supports `.select(cols)` like supabase-js write builders. */
function writeResult(run: () => Promise<{ data: unknown; error: unknown }>) {
  return { ...request(run), select: (_cols: string) => request(run) }
}

export const fakeSupabase = {
  auth: {
    getSession: async () => ({ data: { session: state().sessionUserId ? { user: { id: state().sessionUserId } } : null } }),
  },
  from(table: string) {
    return {
      async upsert(row: RemoteRow, _opts?: unknown) {
        state().writes.push({ table, op: 'upsert', body: row })
        // only `groups` is modelled as a table; other tables (sessions, device_sessions) are just logged
        if (table !== 'groups') return { error: null }
        state().upserts.push(row)
        await maybeGate('upsert')
        state().rows.set(row.id, row)
        return { error: null }
      },
      /** INSERT: unique violation (23505) when the id exists. Returns the stored updated_at. */
      insert(row: RemoteRow) {
        return writeResult(async () => {
          state().writes.push({ table, op: 'insert', body: row })
          state().upserts.push(row)
          await maybeGate('upsert')
          if (state().failInsert) return { data: null, error: OFFLINE }
          if (state().rows.has(row.id)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
          state().rows.set(row.id, row)
          return { data: [{ updated_at: row.updated_at }], error: null }
        })
      },
      /**
       * UPDATE with chained `.eq()` filters (id, user_id and optionally updated_at = compare-and-swap).
       * A patch carrying `windows` is a content write (logged in `upserts`, gate 'upsert'); anything
       * else is a position-only write (logged in `updates`). Both run the 001 trigger (new updated_at),
       * except a position-only write when `trigger020` is on.
       */
      update(patch: Record<string, unknown>) {
        const filters: Array<[string, unknown]> = []
        const q = {
          eq: (c: string, v: unknown) => {
            filters.push([c, v])
            return q
          },
          select: (_cols: string) => request(run),
          then: (resolve: (v: { data: unknown; error: unknown }) => unknown, reject?: (e: unknown) => unknown) => run().then(resolve, reject),
        }
        async function run(): Promise<{ data: unknown; error: unknown }> {
          const id = String(filters.find(([c]) => c === 'id')?.[1])
          const isContent = 'windows' in patch
          state().writes.push({ table, op: 'update', body: patch })
          if (isContent) {
            state().upserts.push({ ...(patch as RemoteRow), id })
            await maybeGate('upsert')
          } else {
            state().updates.push({ id, patch })
          }
          const row = state().rows.get(id)
          const matches = !!row && filters.every(([c, v]) => (row as Record<string, unknown>)[c] === v)
          if (!matches || !row) return { data: [], error: null }
          const stamp = !isContent && state().trigger020 ? row.updated_at : nextStamp()
          state().rows.set(id, { ...row, ...patch, updated_at: stamp })
          return { data: [{ updated_at: stamp }], error: null }
        }
        return q
      },
      select(_cols: string, _opts?: { count?: 'exact' }) {
        let filtersId: string | undefined
        let afterId: string | null = null
        const b = {
          eq: (c: string, v: string) => {
            if (c === 'id') filtersId = v
            return b
          },
          /** Keyset cursor: only rows whose id sorts after `v`. */
          gt: (_c: string, v: string) => {
            afterId = v
            return b
          },
          abortSignal: (_signal: AbortSignal) => b,
          /** Single-row probe (legacy-row detection): never gated. */
          maybeSingle: async () => {
            if (state().failProbe) return { data: null, error: OFFLINE }
            const id = filtersId
            const row = id ? state().rows.get(id) : undefined
            return { data: row ? { updated_at: row.updated_at } : null, error: null }
          },
          /**
           * `[.gt('id', cursor)].order('id').limit(n)`: one keyset page, like PostgREST (rows sorted by
           * id, only those after the cursor, at most `n`). A bare await (no `.limit`) returns everything.
           * `failAfterPages` makes every page after that many answered ones fail.
           */
          order: (_c: string, _o?: unknown) => {
            const snapshot = async (limit = Infinity) => {
              await maybeGate('select')
              const s = state()
              const cursor = afterId
              const fail = s.failAfterPages !== null && s.selects.length >= s.failAfterPages
              s.selects.push(cursor)
              if (fail) return { data: null, error: OFFLINE }
              // snapshot AFTER the gate, like a real server answering late
              // RLS: an anon request (signed out) sees no rows at all, and that is a SUCCESSFUL answer
              const visible = s.sessionUserId ? [...s.rows.values()] : []
              const all = visible
                .filter((r) => cursor === null || r.id > cursor)
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
                .map((r) => ({ ...r }))
              // `count` = rows matching the filter, like PostgREST's `count: 'exact'` (not capped by limit / max_rows)
              const page = { data: all.slice(0, Math.min(limit, s.maxRows)), error: null, count: all.length }
              if (s.afterPage && s.afterPage.page === s.selects.length) {
                const { run } = s.afterPage
                s.afterPage = null
                run()
              }
              return page
            }
            return { ...request(() => snapshot()), limit: (n: number) => request(() => snapshot(n)) }
          },
        }
        return b
      },
      delete() {
        return {
          in: (_c: string, ids: string[]) => ({
            eq: (_c2: string, _v: string) =>
              request(async () => {
                state().deleteCalls.push(ids)
                if (state().failDelete) return { error: OFFLINE }
                for (const id of ids) state().rows.delete(id)
                return { error: null }
              }),
          }),
        }
      },
    }
  },
  channel(_name: string) {
    const ch = {
      on(_type: string, _filter: unknown, cb: NonNullable<FakeRemoteState['realtimeCb']>) {
        state().realtimeCb = cb
        return ch
      },
      subscribe() {
        return ch
      },
    }
    return ch
  },
  removeChannel: async (_ch: unknown) => undefined,
}
