import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { nanoid } from 'nanoid'
import { supabase } from '@/lib/supabase'
import { pushPendingChanges, performSync } from '@/lib/syncEngine'
import { setupEncryption } from '@/lib/encryptionKey'
import { updateGroupsState, getGroupsState } from '@/lib/localDb'
import { createGroup } from '@/lib/utils'
import type { Group } from '@/lib/types'
import type { Session } from '@supabase/supabase-js'

// ponytail: real network, real Supabase branch — proves the actual security property
// (ciphertext at rest), not just that encrypt/decrypt round-trips (that's unit-tested in
// packages/shared/src/__tests__/crypto.test.ts).
const hasTestBranch = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY &&
    process.env.TEST_USER_EMAIL &&
    process.env.TEST_USER_PASSWORD
)

const MARKER = 'SECRET_INTEGRATION_TEST_MARKER'
const MARKER_URL = 'https://example.com/should-not-be-readable'

describe.skipIf(!hasTestBranch)('encryption — real Supabase branch integration', () => {
  let session: Session
  const createdGroupIds: string[] = []

  beforeAll(async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: process.env.TEST_USER_EMAIL!,
      password: process.env.TEST_USER_PASSWORD!
    })
    if (error || !data.session) {
      throw new Error(`Failed to sign in test user on Supabase branch: ${error?.message}`)
    }
    session = data.session
    await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token
    })
    // setupEncryption only INSERTs (the server refuses a second key): clear a row an aborted
    // earlier run may have left behind.
    await supabase.from('encryption_keys').delete().eq('user_id', session.user.id)
    await setupEncryption('integration-test-passphrase-do-not-use-in-prod')
  })

  afterEach(async () => {
    if (createdGroupIds.length > 0) {
      await supabase.from('groups').delete().in('id', createdGroupIds)
      createdGroupIds.length = 0
    }
  })

  afterAll(async () => {
    await supabase.from('encryption_keys').delete().eq('user_id', session.user.id)
    await supabase.auth.signOut()
  })

  it('stores ciphertext in Supabase, never the plaintext marker, then decrypts correctly on pull', async () => {
    const group: Group = { ...createGroup(nanoid(10), 'Encryption Integration Test'), pendingSync: true }
    group.windows = [
      {
        id: 1,
        starred: false,
        incognito: false,
        focused: false,
        tabs: [{ id: 0, title: MARKER, url: MARKER_URL, favIconUrl: '' }]
      }
    ]
    createdGroupIds.push(group.id)
    await updateGroupsState((s) => ({ ...s, available: [...s.available, group] }))
    await pushPendingChanges(session)

    const { data: row, error } = await supabase.from('groups').select('*').eq('id', group.id).single()
    expect(error).toBeNull()
    expect(row).toBeTruthy()

    // The actual property under test: raw Supabase storage is ciphertext, not plaintext.
    expect(Array.isArray(row!.windows)).toBe(false)
    expect(row!.windows).toMatchObject({ v: 1 })
    expect(row!.windows).toHaveProperty('iv')
    expect(row!.windows).toHaveProperty('ct')

    const rawRowJson = JSON.stringify(row)
    expect(rawRowJson).not.toContain(MARKER)
    expect(rawRowJson).not.toContain('should-not-be-readable')
    expect(row!.name).toBe('')

    // Round trip: forget the local copy, then a sync cycle's real decrypt surfaces the marker content.
    await updateGroupsState((s) => ({ ...s, available: s.available.filter((g) => g.id !== group.id) }))
    await performSync(session)
    const pulled = (await getGroupsState()).available.find((g) => g.id === group.id)
    expect(pulled?.name).toBe('Encryption Integration Test')
    expect(pulled?.windows[0]?.tabs[0]?.title).toBe(MARKER)
    expect(pulled?.windows[0]?.tabs[0]?.url).toBe(MARKER_URL)
  })
})
