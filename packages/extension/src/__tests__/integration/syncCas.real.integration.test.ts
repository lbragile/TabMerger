import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { pushPendingChanges, performSync } from '@/lib/syncEngine'
import { updateGroupsState, getGroupsState } from '@/lib/localDb'
import { createGroup } from '@/lib/utils'
import type { Group } from '@/lib/types'
import { setupEncryption } from '@/lib/encryptionKey'
import { setupFreshEncryption, removeEncryption, readableRow, editRowContentAs } from './realEncryption'

// Real-server proof of the compare-and-swap push (syncEngine.pushGroup / pushPosition) against the
// LOCAL Supabase stack (migrations 001-020). No fake, no mocked supabase-js. Skipped unless the
// same four env vars as the other real-network suites are set. The free-user test additionally
// needs TEST_FREE_USER_EMAIL / TEST_FREE_USER_PASSWORD (a user whose subscription stays 'free').
//
// NEVER point this at a remote project: it deletes every `groups` row of TEST_USER_EMAIL.
const hasTestBranch = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY &&
    process.env.TEST_USER_EMAIL &&
    process.env.TEST_USER_PASSWORD
)
const hasFreeUser = Boolean(process.env.TEST_FREE_USER_EMAIL && process.env.TEST_FREE_USER_PASSWORD)

const CONFLICT_SUFFIX = ' (conflict copy)'

/**
 * Node's built-in (undici) WebSocket cannot dispatch events under the jsdom environment's `Event`
 * ("event argument must be an instance of Event"), so realtime needs the `ws` package as transport.
 * It is not a direct dependency: resolve it from the pnpm store (a transitive dep of supabase-js).
 * Returns null when it cannot be found, and the realtime test reports that instead of failing.
 */
function loadWsTransport(): unknown | null {
  const req = createRequire(import.meta.url)
  try {
    return req('ws')
  } catch {
    /* not hoisted */
  }
  let dir = process.cwd()
  for (let i = 0; i < 4; i++, dir = path.dirname(dir)) {
    const store = path.join(dir, 'node_modules', '.pnpm')
    if (!fs.existsSync(store)) continue
    const hit = fs.readdirSync(store).find((n) => /^ws@\d/.test(n))
    if (hit) return req(path.join(store, hit, 'node_modules', 'ws'))
  }
  return null
}

/** A second, independent supabase-js client ("another device") signed in as the same user. */
async function signInOtherDevice(email: string, password: string): Promise<SupabaseClient> {
  const transport = loadWsTransport()
  const client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(transport ? { realtime: { transport: transport as never } } : {})
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`other-device sign-in failed: ${error.message}`)
  return client
}

async function addLocal(group: Group): Promise<void> {
  await updateGroupsState((s) => ({ ...s, available: [...s.available, group] }))
}

async function localGroup(id: string): Promise<Group | undefined> {
  return (await getGroupsState()).available.find((g) => g.id === id)
}

/** A local content edit as the app makes it: new name, fresh updatedAt, pending. */
async function editLocal(id: string, patch: Partial<Group>): Promise<void> {
  await updateGroupsState((s) => ({
    ...s,
    available: s.available.map((g) =>
      g.id === id ? { ...g, ...patch, updatedAt: Math.max(g.updatedAt + 1, Date.now()), pendingSync: true } : g
    )
  }))
}

describe.skipIf(!hasTestBranch)('syncEngine compare-and-swap push - real local Supabase', () => {
  let session: Session
  let other: SupabaseClient
  let userId: string

  /** The row as the account reads it: pushed content is ciphertext, so it is decrypted here. */
  const remoteRow = async (id: string) => {
    const { data, error } = await other.from('groups').select('*').eq('id', id).maybeSingle()
    expect(error).toBeNull()
    return readableRow(data as (Record<string, unknown> & { updated_at: string; name: string; position: number }) | null)
  }

  async function wipeRemote(): Promise<void> {
    await other.from('groups').delete().eq('user_id', userId)
  }

  beforeAll(async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: process.env.TEST_USER_EMAIL!,
      password: process.env.TEST_USER_PASSWORD!
    })
    if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`)
    session = data.session
    userId = session.user.id
    // chrome.storage.local is an in-memory stub here; force the session so requests are not anon.
    await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
    other = await signInOtherDevice(process.env.TEST_USER_EMAIL!, process.env.TEST_USER_PASSWORD!)
    // content is only ever pushed encrypted: without a key nothing would be uploaded at all
    await setupFreshEncryption(userId)
  })

  beforeEach(async () => {
    await wipeRemote()
    // fresh local list: only Now Open stays
    await updateGroupsState((s) => ({ ...s, available: s.available.filter((g) => g.permanent) }))
  })

  afterAll(async () => {
    await wipeRemote()
    await removeEncryption(userId)
    // local scope only: a global sign-out would revoke the other real-network suites' sessions
    await other?.auth.signOut({ scope: 'local' })
    await supabase.auth.signOut({ scope: 'local' })
  })

  it('(a) insert stores the server stamp as the base; a second edit with that base updates exactly one row and stores the new base', async () => {
    const g = createGroup(nanoid(10), 'CAS A')
    await addLocal(g)
    await pushPendingChanges(session)

    const afterInsert = await localGroup(g.id)
    const row1 = await remoteRow(g.id)
    expect(row1).not.toBeNull()
    expect(afterInsert?.pendingSync).toBe(false)
    // the exact string PostgREST returned is what the next CAS filter is built from
    expect(afterInsert?.remoteUpdatedAt).toBe(row1!.updated_at)
    expect(afterInsert?.remoteUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+/)

    await editLocal(g.id, { name: 'CAS A edited' })
    await pushPendingChanges(session)

    const afterEdit = await localGroup(g.id)
    const row2 = await remoteRow(g.id)
    expect(row2!.name).toBe('CAS A edited')
    expect(afterEdit?.pendingSync).toBe(false)
    expect(afterEdit?.remoteUpdatedAt).toBe(row2!.updated_at)
    expect(row2!.updated_at).not.toBe(row1!.updated_at) // content push bumps the stamp (server clock)
    const { count } = await other.from('groups').select('id', { count: 'exact', head: true }).eq('user_id', userId)
    expect(count).toBe(1)
  })

  it('(b) another client edits the row: this device\'s pending edit gets zero rows, then performSync yields remote under the original name plus a pushed conflict copy', async () => {
    const g = createGroup(nanoid(10), 'CAS B')
    await addLocal(g)
    await pushPendingChanges(session)
    const base = (await localGroup(g.id))!.remoteUpdatedAt!

    // other device edits
    const { error } = await editRowContentAs(other, g.id, { name: 'CAS B from other device' })
    expect(error).toBeNull()
    const foreign = await remoteRow(g.id)
    expect(foreign!.updated_at).not.toBe(base)

    // this device edits offline-ish and pushes with the stale base
    await editLocal(g.id, { name: 'CAS B local edit' })
    await pushPendingChanges(session)
    const stillPending = await localGroup(g.id)
    expect(stillPending?.pendingSync).toBe(true) // zero rows came back
    expect(stillPending?.remoteUpdatedAt).toBe(base)
    expect((await remoteRow(g.id))!.name).toBe('CAS B from other device') // nothing overwritten

    await performSync(session)

    // cycle 1 resolves the conflict (push runs before the merge, so the copy is created pending)
    const mid = (await getGroupsState()).available.find((x) => x.name === `CAS B local edit${CONFLICT_SUFFIX}`)
    expect(mid?.pendingSync).toBe(true)
    expect(mid?.remoteUpdatedAt).toBeUndefined()
    await performSync(session) // cycle 2 inserts the copy as a new row

    const state = await getGroupsState()
    const original = state.available.find((x) => x.id === g.id)!
    const copy = state.available.find((x) => x.name === `CAS B local edit${CONFLICT_SUFFIX}`)
    expect(original.name).toBe('CAS B from other device')
    expect(original.remoteUpdatedAt).toBe(foreign!.updated_at)
    expect(copy).toBeTruthy()
    expect(copy!.id).not.toBe(g.id)
    expect(copy!.pendingSync).toBe(false)
    const copyRow = await remoteRow(copy!.id)
    expect(copyRow).not.toBeNull()
    expect(copy!.remoteUpdatedAt).toBe(copyRow!.updated_at)
    expect((await remoteRow(g.id))!.name).toBe('CAS B from other device')
  })

  it('(c) equal content after a foreign stamp change: no copy, base adopted, no redundant push', async () => {
    const g = createGroup(nanoid(10), 'CAS C')
    await addLocal(g)
    await pushPendingChanges(session)
    const base = (await localGroup(g.id))!.remoteUpdatedAt!

    // other device writes the SAME content this device is about to push (stamp changes, content equal)
    expect((await editRowContentAs(other, g.id, { name: 'CAS C same' })).error).toBeNull()
    const foreign = await remoteRow(g.id)
    expect(foreign!.updated_at).not.toBe(base)
    await editLocal(g.id, { name: 'CAS C same' })

    await performSync(session)

    const state = await getGroupsState()
    expect(state.available.filter((x) => x.name.endsWith(CONFLICT_SUFFIX))).toHaveLength(0)
    const after = state.available.find((x) => x.id === g.id)!
    expect(after.pendingSync).toBe(false)
    expect(after.remoteUpdatedAt).toBe(foreign!.updated_at)
    expect((await remoteRow(g.id))!.updated_at).toBe(foreign!.updated_at) // no redundant push
    const { count } = await other.from('groups').select('id', { count: 'exact', head: true }).eq('user_id', userId)
    expect(count).toBe(1)
  })

  it('(d) a position-only push leaves updated_at unchanged on the server (migration 020) and the stored base still matches the next content push', async () => {
    const a = createGroup(nanoid(10), 'CAS D1')
    const b = createGroup(nanoid(10), 'CAS D2')
    await addLocal(a)
    await addLocal(b)
    await pushPendingChanges(session)
    const stampA = (await remoteRow(a.id))!.updated_at
    expect((await remoteRow(a.id))!.position).toBe(1)
    expect((await remoteRow(b.id))!.position).toBe(2)

    // reorder locally: swap and flag both position-dirty (content untouched)
    await updateGroupsState((s) => {
      const [now, x, y] = s.available
      return { ...s, available: [now, { ...y, positionDirty: true }, { ...x, positionDirty: true }] }
    })
    await pushPendingChanges(session)

    const rowA = await remoteRow(a.id)
    const rowB = await remoteRow(b.id)
    expect(rowA!.position).toBe(2)
    expect(rowB!.position).toBe(1)
    expect(rowA!.updated_at).toBe(stampA) // trigger 020 kept the stamp
    const localA = await localGroup(a.id)
    expect(localA?.positionDirty).toBeFalsy()
    expect(localA?.remoteUpdatedAt).toBe(stampA)

    // base still valid: a content push now succeeds with zero conflicts
    await editLocal(a.id, { name: 'CAS D1 edited' })
    await pushPendingChanges(session)
    expect((await remoteRow(a.id))!.name).toBe('CAS D1 edited')
    expect((await localGroup(a.id))?.pendingSync).toBe(false)
  })

  it('(e) row deleted remotely while a local edit is pending: the edit survives as a conflict copy', async () => {
    const g = createGroup(nanoid(10), 'CAS E')
    await addLocal(g)
    await pushPendingChanges(session)
    expect((await localGroup(g.id))!.remoteUpdatedAt).toBeTruthy()

    await other.from('groups').delete().eq('id', g.id)
    await editLocal(g.id, { name: 'CAS E precious edit' })

    await performSync(session)
    await performSync(session) // the copy is created pending by cycle 1 and inserted by cycle 2

    const state = await getGroupsState()
    expect(state.available.find((x) => x.id === g.id)).toBeUndefined()
    const copy = state.available.find((x) => x.name === `CAS E precious edit${CONFLICT_SUFFIX}`)
    expect(copy).toBeTruthy()
    expect(copy!.pendingSync).toBe(false)
    expect(await remoteRow(copy!.id)).not.toBeNull()
    expect(await remoteRow(g.id)).toBeNull()
  })

  it('(f) a free (non-Pro) user\'s writes are rejected by RLS (insert, and update of a row)', async () => {
    // Pro user creates a row to try to modify, free user attempts everything on their own ids.
    if (!hasFreeUser) {
      console.warn('TEST_FREE_USER_EMAIL/PASSWORD not set - skipping the free-user RLS check')
      return
    }
    const free = await signInOtherDevice(process.env.TEST_FREE_USER_EMAIL!, process.env.TEST_FREE_USER_PASSWORD!)
    const freeId = (await free.auth.getUser()).data.user!.id
    const id = nanoid(10)
    const base = {
      id, user_id: freeId, name: 'free write', color: 'rgba(128,128,128,1)', windows: [], position: 1,
      starred: false, archived: false, note: null, info: '', window_count: 0, tab_count: 0
    }
    try {
      const ins = await free.from('groups').insert(base).select('updated_at')
      expect(ins.error).not.toBeNull() // RLS violation (42501)
      expect(ins.data ?? []).toHaveLength(0)
      expect((await free.from('groups').select('id').eq('id', id)).data ?? []).toHaveLength(0)

      // an existing row owned by the free user (inserted as service-role would be needed); instead
      // prove update is gated: a CAS update on the PRO user's row from the free client matches nothing.
      const proRowId = nanoid(10)
      await addLocal({ ...createGroup(proRowId, 'pro row'), pendingSync: true })
      await pushPendingChanges(session)
      const proStamp = (await remoteRow(proRowId))!.updated_at
      const upd = await free.from('groups').update({ name: 'hijack' }).eq('id', proRowId).eq('updated_at', proStamp).select('updated_at')
      expect(upd.data ?? []).toHaveLength(0)
      expect((await remoteRow(proRowId))!.name).toBe('pro row')
    } finally {
      await free.auth.signOut({ scope: 'local' })
    }
  })

  it('(f2) the engine on a free account: the server refuses it an encryption key, so the push writes no row and the group stays pending', async () => {
    if (!hasFreeUser) return
    const freeClient = await signInOtherDevice(process.env.TEST_FREE_USER_EMAIL!, process.env.TEST_FREE_USER_PASSWORD!)
    const { data: freeSession } = await freeClient.auth.getSession()
    // point the module client at the free account for this test, then restore the Pro session
    await supabase.auth.setSession({ access_token: freeSession.session!.access_token, refresh_token: freeSession.session!.refresh_token })
    try {
      // Server-side gate: RLS rejects the key insert of a non-Pro account (migration 019), and
      // without a key the engine uploads no content at all (the raw insert is rejected too, see (f)).
      await expect(setupEncryption('free-account-passphrase')).rejects.toThrow()
      const keys = await freeClient.from('encryption_keys').select('user_id').eq('user_id', freeSession.session!.user.id)
      expect(keys.data ?? []).toHaveLength(0)

      const g = createGroup(nanoid(10), 'free engine push')
      await addLocal(g)
      await pushPendingChanges(freeSession.session!)
      const after = await localGroup(g.id)
      expect(after?.pendingSync).toBe(true)
      expect(after?.remoteUpdatedAt).toBeUndefined()
      const { data } = await freeClient.from('groups').select('id').eq('id', g.id)
      expect(data ?? []).toHaveLength(0)
    } finally {
      await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
      await freeClient.auth.signOut({ scope: 'local' })
    }
  })

  it('(g) the realtime UPDATE echo of this device\'s own push carries the same updated_at string as the REST response', async () => {
    if (!loadWsTransport()) {
      console.warn('ws transport not found - realtime echo check not run')
      return
    }
    const g = createGroup(nanoid(10), 'CAS G')
    await addLocal(g)
    await pushPendingChanges(session)
    const base = (await localGroup(g.id))!.remoteUpdatedAt!

    const events: Array<{ id: string; updated_at: string }> = []
    // the realtime socket must carry the user's JWT or RLS filters every row out
    const { data: otherSession } = await other.auth.getSession()
    await other.realtime.setAuth(otherSession.session!.access_token)
    const channel = other
      .channel(`cas-g-${nanoid(6)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'groups', filter: `user_id=eq.${userId}` }, (p) => {
        events.push(p.new as { id: string; updated_at: string })
      })
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('realtime subscribe timeout')), 8000)
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') { clearTimeout(t); resolve() }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(t); reject(new Error(`realtime ${status}`)) }
      })
    })
    try {
      await editLocal(g.id, { name: 'CAS G edited' })
      await pushPendingChanges(session)
      const stored = (await localGroup(g.id))!.remoteUpdatedAt!
      expect(stored).not.toBe(base)

      const deadline = Date.now() + 8000
      while (!events.some((e) => e.id === g.id) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
      const echo = events.find((e) => e.id === g.id)
      expect(echo).toBeTruthy()
      // the app compares these strings (subscribeToRemoteChanges ignores the echo only if equal)
      expect(echo!.updated_at).toBe(stored)
    } finally {
      await other.removeChannel(channel)
    }
  }, 30000)
})
