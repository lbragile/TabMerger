import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Session as AuthSession } from '@supabase/supabase-js'
import { generateDataKey, isEncryptedBlob } from '@tabmerger/shared'
import { performSync } from '@/lib/syncEngine'
import { pushDeviceSession, DEVICE_SESSION_DEBOUNCE_MS } from '@/lib/deviceSessions'
import { pushSessionToSupabase } from '@/hooks/useSessions'
import { getGroupsState, saveGroupsState, markPositionSynced, setSetting } from '@/lib/localDb'
import { getEncryptionKeyState, getDataKey, type EncryptionKeyState } from '@/lib/encryptionKey'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import type { Group, Session } from '@/lib/types'
import { clearDb } from './dbTestUtils'
import { fakeRemote, type RemoteRow } from './fakeSupabase'

// Invariant: E2E encryption is mandatory. No request this device sends may carry group, session or
// Now Open content in the clear, whatever the encryption state is: key missing (setup not finished),
// status unknown (the check failed) or key locked. Such uploads are skipped and stay pending.
// Every write request body, for every table, is recorded by the fake (`fakeRemote.writes`).

vi.mock('@/lib/supabase', async () => {
  const m = await import('./fakeSupabase')
  return { supabase: m.fakeSupabase, isSupabaseConfigured: true }
})
vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: vi.fn(async () => 'absent'),
  getDataKey: vi.fn(async () => null),
  ENCRYPTION_MIGRATION_DONE_KEY: 'encryptionMigrationDone',
  SESSIONS_MIGRATION_DONE_KEY: 'sessionsEncryptionMigrationDone',
}))

const auth = { user: { id: 'user-1' } } as unknown as AuthSession
const BASE = '2030-01-01T00:00:00.000Z'

const SECRETS = {
  tabTitle: 'SECRET_TAB_TITLE',
  tabUrl: 'https://secret.example/private-path',
  groupName: 'SECRET_GROUP_NAME',
  note: 'SECRET_NOTE',
  info: 'SECRET_INFO',
  editedName: 'SECRET_EDITED_NAME',
  sessionName: 'SECRET_SESSION_NAME',
  sessionDescription: 'SECRET_SESSION_DESCRIPTION',
  nowOpenTitle: 'SECRET_NOW_OPEN_TITLE',
}

const secretWindow = (title: string) => ({
  id: 1, starred: false, incognito: false, focused: false,
  tabs: [{ id: 0, title, url: SECRETS.tabUrl, favIconUrl: '' }],
})
const clean = (id: string, name: string): Group => ({ ...createGroup(id, name), updatedAt: 1000, pendingSync: false, remoteUpdatedAt: BASE })
const rowOf = (g: Group, position: number): RemoteRow => ({
  id: g.id, user_id: 'user-1', name: g.name, color: g.color, updated_at: BASE,
  windows: g.windows, starred: false, archived: false, note: null, info: '', position,
})

/**
 * Local state with every kind of pending upload:
 *  - `fresh`: a new group never pushed (insert);
 *  - `edited`: a group already on the server with an unpushed edit (compare-and-swap update);
 *  - `a`, `b`: clean groups whose order was swapped (position-only updates, metadata).
 */
async function seedPendingUploads(): Promise<void> {
  const nowOpen = { ...createNowOpenGroup(), windows: [secretWindow(SECRETS.nowOpenTitle)] }
  const a = clean('a', 'plain-a')
  const b = clean('b', 'plain-b')
  const edited = clean('edited', 'plain-edited')
  await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, a, b, edited] })
  for (const [i, g] of [a, b, edited].entries()) {
    await markPositionSynced(g.id, i + 1)
    fakeRemote.rows.set(g.id, rowOf(g, i + 1))
  }
  await setSetting('remoteBaseSeeded', true)
  await setSetting('cloudSyncActive', true)

  const fresh: Group = {
    ...createGroup('fresh', SECRETS.groupName),
    windows: [secretWindow(SECRETS.tabTitle)], note: SECRETS.note, info: SECRETS.info, pendingSync: true,
  }
  const s = await getGroupsState()
  const [now, first, second, third] = s.available
  await saveGroupsState({
    ...s,
    // a <-> b swapped; `edited` renamed and marked pending; `fresh` appended
    available: [now, second, first, { ...third, name: SECRETS.editedName, updatedAt: 2000, pendingSync: true }, fresh],
  })
  fakeRemote.writes.length = 0
  fakeRemote.updates.length = 0
  fakeRemote.upserts.length = 0
}

const savedSession = (): Session => ({
  id: 'sess-1',
  name: SECRETS.sessionName,
  description: SECRETS.sessionDescription,
  groups: [{ ...createGroup('sg', SECRETS.groupName), windows: [secretWindow(SECRETS.tabTitle)] }],
  createdAt: 1000,
})

/** One sync cycle + an explicit session upload + the debounced Now Open snapshot upload. */
async function runEveryUploadPath(): Promise<void> {
  await performSync(auth)
  await pushSessionToSupabase(savedSession())
  pushDeviceSession(await getGroupsState(), 'pro')
  await new Promise((r) => setTimeout(r, DEVICE_SESSION_DEBOUNCE_MS + 300))
}

const sentText = () => JSON.stringify(fakeRemote.writes)
function expectNoSecretLeftTheDevice() {
  const sent = sentText()
  for (const [what, secret] of Object.entries(SECRETS)) {
    expect(sent.includes(secret), `${what} was sent in the clear`).toBe(false)
  }
  // shape check on top of the marker scan: content columns are ciphertext or not sent at all
  for (const { table, body } of fakeRemote.writes) {
    if ('windows' in body) expect(isEncryptedBlob(body.windows), `${table}.windows is not ciphertext`).toBe(true)
    if ('groups' in body) expect(isEncryptedBlob(body.groups), `${table}.groups is not ciphertext`).toBe(true)
    if ('now_open_snapshot' in body) expect(isEncryptedBlob(body.now_open_snapshot), `${table}.now_open_snapshot is not ciphertext`).toBe(true)
    if ('windows' in body || 'groups' in body) expect(body.name).toBe('')
  }
}

beforeEach(async () => {
  fakeRemote.reset()
  await clearDb()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('no plaintext content is ever uploaded', () => {
  const blocked: Array<[string, EncryptionKeyState, boolean]> = [
    ['absent (encryption setup not finished)', 'absent', false],
    ['unknown (the status check failed)', 'unknown', false],
    ['present but locked on this device', 'present', false],
  ]

  it.each(blocked)('key %s: content uploads are skipped and stay pending; only positions are sent', async (_label, state, unlocked) => {
    vi.mocked(getEncryptionKeyState).mockResolvedValue(state)
    vi.mocked(getDataKey).mockResolvedValue(unlocked ? await generateDataKey() : null)
    await seedPendingUploads()

    await runEveryUploadPath()

    expectNoSecretLeftTheDevice()
    // nothing but position-only metadata went out
    expect(fakeRemote.writes.map((w) => `${w.table}:${w.op}:${Object.keys(w.body).join(',')}`).sort()).toEqual([
      'groups:update:position',
      'groups:update:position',
    ])
    // ...and the content is still waiting locally for the key
    const local = (await getGroupsState()).available
    expect(local.find((g) => g.id === 'fresh')).toMatchObject({ pendingSync: true, name: SECRETS.groupName })
    expect(local.find((g) => g.id === 'edited')).toMatchObject({ pendingSync: true, name: SECRETS.editedName })
    expect(fakeRemote.rows.has('fresh')).toBe(false)
    expect(fakeRemote.rows.get('edited')?.name).toBe('plain-edited') // the server row was not touched
  }, 15_000)

  it('key present and unlocked: everything is uploaded, as ciphertext only', async () => {
    vi.mocked(getEncryptionKeyState).mockResolvedValue('present')
    vi.mocked(getDataKey).mockResolvedValue(await generateDataKey())
    await seedPendingUploads()

    await runEveryUploadPath()

    expectNoSecretLeftTheDevice()
    const sent = fakeRemote.writes.map((w) => `${w.table}:${w.op}`)
    expect(sent).toEqual(expect.arrayContaining(['groups:insert', 'groups:update', 'sessions:upsert', 'device_sessions:upsert']))
    expect((await getGroupsState()).available.filter((g) => g.pendingSync)).toEqual([])
  }, 15_000)
})
