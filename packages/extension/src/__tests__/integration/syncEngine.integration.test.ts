import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { nanoid } from 'nanoid'
import { supabase } from '@/lib/supabase'
import { pushPendingChanges, performSync, deleteRemoteGroups } from '@/lib/syncEngine'
import { updateGroupsState, getPendingSyncGroups, getGroupsState } from '@/lib/localDb'
import { createGroup } from '@/lib/utils'
import type { Group } from '@/lib/types'
import type { Session } from '@supabase/supabase-js'
import { setupFreshEncryption, removeEncryption, readableRow } from './realEncryption'

// ponytail: real network, real Supabase branch, no vi.mock('@supabase/supabase-js') anywhere
// in this file. Gated on a real .env.test (see .env.test.example) — falls back to skip so
// `pnpm test` / CI without the branch's credentials never breaks.
const hasTestBranch = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY &&
    process.env.TEST_USER_EMAIL &&
    process.env.TEST_USER_PASSWORD
)

/** Adds a group to the local list through the queued RMW (the production write path). */
async function addLocalGroup(group: Group): Promise<void> {
  await updateGroupsState((s) => ({ ...s, available: [...s.available, group] }))
}

/** Drops a group from the local list (as if this device had never pulled it). */
async function dropLocalGroup(id: string): Promise<void> {
  await updateGroupsState((s) => ({ ...s, available: s.available.filter((g) => g.id !== id) }))
}

describe.skipIf(!hasTestBranch)('syncEngine — real Supabase branch integration', () => {
  let session: Session
  const createdGroupIds: string[] = []

  beforeAll(async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: process.env.TEST_USER_EMAIL!,
      password: process.env.TEST_USER_PASSWORD!,
    })
    if (error || !data.session) {
      throw new Error(`Failed to sign in test user on Supabase branch: ${error?.message}`)
    }
    session = data.session
    // ponytail: chrome.storage.local is mocked to always resolve {} in this test env, so the
    // client's async storage-hydration read can race with signInWithPassword and reset the
    // in-memory session to null right after sign-in, causing inserts to run as anon. Force it.
    await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    })
    // content is only ever pushed encrypted: without a key nothing would be uploaded at all
    await setupFreshEncryption(session.user.id)
  })

  afterAll(async () => {
    if (createdGroupIds.length > 0) {
      await supabase.from('groups').delete().in('id', createdGroupIds)
    }
    await removeEncryption(session.user.id)
    await supabase.auth.signOut()
  })

  it('pushes a pending group then pulls it back (push/pull round trip)', async () => {
    const group: Group = { ...createGroup(nanoid(10), 'Integration Push Test'), pendingSync: true }
    createdGroupIds.push(group.id)
    await addLocalGroup(group)

    const pendingBefore = await getPendingSyncGroups()
    expect(pendingBefore.some((g) => g.id === group.id)).toBe(true)

    await pushPendingChanges(session)

    const pendingAfter = await getPendingSyncGroups()
    expect(pendingAfter.some((g) => g.id === group.id)).toBe(false)

    const { data: row } = await supabase.from('groups').select('*').eq('id', group.id).single()
    expect(row?.name).toBe('') // the plaintext column is blank: the name lives in the encrypted blob
    expect((await readableRow(row))?.name).toBe('Integration Push Test')

    // a sync cycle should surface it again when this device does not have it locally
    await dropLocalGroup(group.id)
    await performSync(session)
    expect((await getGroupsState()).available.some((g) => g.id === group.id)).toBe(true)
  })

  it('deleteRemoteGroups actually deletes rows server-side', async () => {
    const group: Group = { ...createGroup(nanoid(10), 'Integration Delete Test'), pendingSync: true }
    createdGroupIds.push(group.id)
    await addLocalGroup(group)
    await pushPendingChanges(session)

    const { data: before } = await supabase.from('groups').select('id').eq('id', group.id)
    expect(before).toHaveLength(1)

    await deleteRemoteGroups([group.id])

    const { data: after } = await supabase.from('groups').select('id').eq('id', group.id)
    expect(after).toHaveLength(0)
  })

  it('removes a group from local IDB when it was deleted remotely by another device (real IDB round trip)', async () => {
    // Simulate: this device already synced the group (pendingSync:false) and saved it to IDB —
    // then a different device (or the web dashboard) hard-deleted it on Supabase directly,
    // bypassing this device's deleteRemoteGroups/pendingDeleteGroupIds entirely.
    const group: Group = { ...createGroup(nanoid(10), 'Integration Remote-Delete Test'), pendingSync: true }
    await addLocalGroup(group)
    await pushPendingChanges(session) // marks pendingSync:false locally, row now exists remotely

    // Remove the row directly (not via deleteRemoteGroups, so no pendingDeleteGroupIds entry is set)
    await supabase.from('groups').delete().eq('id', group.id)

    const state = await getGroupsState()
    expect(state.available.some((g) => g.id === group.id)).toBe(true) // still present locally pre-pull

    await performSync(session)

    const stateAfter = await getGroupsState()
    expect(stateAfter.available.some((g) => g.id === group.id)).toBe(false) // the sync cycle's write dropped it from IDB
  })
})
