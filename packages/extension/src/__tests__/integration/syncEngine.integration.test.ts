import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { nanoid } from 'nanoid'
import { supabase } from '@/lib/supabase'
import { pushPendingChanges, pullRemoteChanges, deleteRemoteGroups } from '@/lib/syncEngine'
import { saveGroup, getPendingSyncGroups, getGroupsState } from '@/lib/localDb'
import { createGroup } from '@/lib/utils'
import type { Group } from '@/lib/types'
import type { Session } from '@supabase/supabase-js'

// ponytail: real network, real Supabase branch, no vi.mock('@supabase/supabase-js') anywhere
// in this file. Gated on a real .env.test (see .env.test.example) — falls back to skip so
// `pnpm test` / CI without the branch's credentials never breaks.
const hasTestBranch = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY &&
    process.env.TEST_USER_EMAIL &&
    process.env.TEST_USER_PASSWORD
)

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
  })

  afterAll(async () => {
    if (createdGroupIds.length > 0) {
      await supabase.from('groups').delete().in('id', createdGroupIds)
    }
    await supabase.auth.signOut()
  })

  it('pushes a pending group then pulls it back (push/pull round trip)', async () => {
    const group: Group = { ...createGroup(nanoid(10), 'Integration Push Test'), pendingSync: true }
    createdGroupIds.push(group.id)
    await saveGroup(group)

    const pendingBefore = await getPendingSyncGroups()
    expect(pendingBefore.some((g) => g.id === group.id)).toBe(true)

    await pushPendingChanges(session)

    const pendingAfter = await getPendingSyncGroups()
    expect(pendingAfter.some((g) => g.id === group.id)).toBe(false)

    const { data: row } = await supabase.from('groups').select('*').eq('id', group.id).single()
    expect(row?.name).toBe('Integration Push Test')

    // pullRemoteChanges should surface it when merging against an empty local list
    const merged = await pullRemoteChanges(session, [])
    expect(merged.some((g) => g.id === group.id)).toBe(true)
  })

  it('deleteRemoteGroups actually deletes rows server-side', async () => {
    const group: Group = { ...createGroup(nanoid(10), 'Integration Delete Test'), pendingSync: true }
    createdGroupIds.push(group.id)
    await saveGroup(group)
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
    await saveGroup(group)
    await pushPendingChanges(session) // marks pendingSync:false locally, row now exists remotely

    // Remove the row directly (not via deleteRemoteGroups, so no pendingDeleteGroupIds entry is set)
    await supabase.from('groups').delete().eq('id', group.id)

    const state = await getGroupsState()
    expect(state.available.some((g) => g.id === group.id)).toBe(true) // still present locally pre-pull

    const merged = await pullRemoteChanges(session, state.available)
    expect(merged.some((g) => g.id === group.id)).toBe(false)

    const stateAfter = await getGroupsState()
    expect(stateAfter.available.some((g) => g.id === group.id)).toBe(false) // deleteGroup actually persisted to IDB
  })
})
