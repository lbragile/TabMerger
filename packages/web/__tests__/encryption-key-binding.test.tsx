import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { GroupGrid } from '@/components/dashboard/GroupGrid'
import { SessionList } from '@/components/dashboard/SessionList'
import { DevicesSection } from '@/components/account/DevicesSection'
import { EncryptionKeyProvider, useEncryptionKey, clearAllCachedDataKeys } from '@/lib/encryption/context'

/**
 * The dashboard's cached data key is only valid for the `encryption_keys` row it was unwrapped
 * from. These tests cover the binding (fingerprint stored beside the key), the check on load, the
 * re-check after a decrypt failure, and the note for rows that stay unreadable under a good key.
 */

const USER_ID = 'u1'
const CACHE_ENTRY = `tabmerger:dataKey:${USER_ID}`

interface KeyRow {
  user_id: string
  salt: string
  wrap_iv: string
  /** "<data key>|<passphrase>": the stubbed unwrap below returns the data key for that passphrase only. */
  wrapped_key: string
  kdf_iterations: number
}

const ROW_A: KeyRow = { user_id: USER_ID, salt: 'AAAA', wrap_iv: 'ivA', wrapped_key: 'key-A|first passphrase', kdf_iterations: 1000 }
/** What the account has after a reset and a new setup: new salt, new wrap IV, new data key. */
const ROW_B: KeyRow = { user_id: USER_ID, salt: 'BBBB', wrap_iv: 'ivB', wrapped_key: 'key-B|second passphrase', kdf_iterations: 1000 }

const fingerprintOf = (row: KeyRow) => `${row.salt}.${row.wrap_iv}`

/** What the server answers for the key row. `undefined` makes the lookup itself fail. */
let keyRow: KeyRow | null | undefined = ROW_A
let lookupDelayMs = 0

const mockMaybeSingle = vi.fn(async (_columns: string) => {
  if (lookupDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, lookupDelayMs))
  if (keyRow === undefined) return { data: null, error: { message: 'Failed to fetch' } }
  return { data: keyRow, error: null }
})

/** Lookups that only compare the key row (on load and on re-check), not the full read `unlock()` does. */
const keyRowChecks = () => mockMaybeSingle.mock.calls.filter(([columns]) => columns !== '*').length

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: () => ({
      select: (columns: string) => ({
        eq: () => ({ maybeSingle: () => mockMaybeSingle(columns) }),
      }),
    }),
  }),
}))

// Real WebCrypto is replaced by strings: a data key is its name ("key-A"), a blob records the key
// it was encrypted with, and decrypting with any other key throws like a failed GCM tag check.
vi.mock('@tabmerger/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tabmerger/shared')>()
  return {
    ...actual,
    deriveWrappingKey: vi.fn(async (passphrase: string) => `wrap(${passphrase})` as unknown as CryptoKey),
    unwrapDataKey: vi.fn(async (wrappedKey: string, _iv: string, wrappingKey: unknown) => {
      const [dataKey, passphrase] = wrappedKey.split('|')
      if (wrappingKey !== `wrap(${passphrase})`) throw new Error('wrong passphrase')
      return dataKey as unknown as CryptoKey
    }),
    exportKeyToBase64: vi.fn(async (key: unknown) => `b64(${key})`),
    importKeyFromBase64: vi.fn(async (b64: string) => {
      if (!/^b64\(.*\)$/.test(b64)) throw new Error('not a key')
      return b64.slice(4, -1) as unknown as CryptoKey
    }),
    decryptBlob: vi.fn(async (key: unknown, blob: unknown) => {
      const { __key, __plain } = blob as { __key: string; __plain: unknown }
      if (key !== __key) throw new Error('auth tag mismatch')
      return __plain
    }),
  }
})

function blob(key: string, plain: unknown, iv: string) {
  return { v: 1, iv, ct: 'ct', __key: key, __plain: plain }
}

function group(id: string, key: string, name: string) {
  return {
    id,
    name: '',
    color: 'rgba(0,180,204,1)',
    windows: blob(key, { name, windows: [{ tabs: [{ title: `${name} tab`, url: 'https://example.com' }] }] }, `iv-${id}-${key}`),
    updated_at: new Date().toISOString(),
  }
}

function session(id: string, key: string, name: string) {
  return {
    id,
    name: '',
    groups: blob(key, { name, groups: [{ name: 'G', windows: [{ tabs: [{ url: 'https://example.com' }] }] }] }, `iv-${id}-${key}`),
    created_at: new Date().toISOString(),
  }
}

function device(id: string, key: string) {
  return {
    id,
    device_id: `device-${id}`,
    device_name: `Laptop ${id}`,
    now_open_snapshot: blob(key, { windows: [{ tabs: [{}, {}] }] }, `iv-${id}-${key}`),
    last_active: new Date().toISOString(),
  }
}

/** Puts a data key in the tab's cache, bound to `row` (or unbound, as the previous version wrote it). */
function seedCache(dataKey: string, row: KeyRow | 'legacy') {
  sessionStorage.setItem(
    CACHE_ENTRY,
    row === 'legacy' ? `b64(${dataKey})` : JSON.stringify({ key: `b64(${dataKey})`, fingerprint: fingerprintOf(row) }),
  )
}

function Probe() {
  const { status } = useEncryptionKey()
  return <span>status:{status}</span>
}

function Dashboard({ groups, sessions }: { groups?: unknown[]; sessions?: unknown[] }) {
  return (
    <EncryptionKeyProvider>
      <Probe />
      {groups && <GroupGrid groups={groups as never} isPro />}
      {sessions && <SessionList sessions={sessions as never} isPro />}
    </EncryptionKeyProvider>
  )
}

/** Lets every pending decrypt pass, lookup and state update finish. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}

async function unlockWith(passphrase: string) {
  fireEvent.change(await screen.findByLabelText('Encryption passphrase'), { target: { value: passphrase } })
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
}

const NOTE = /saved with an earlier passphrase/i

// The provider treats a key as "just verified" for a short time after a check. Tests move the
// clock forward to step outside that window without waiting.
const realNow = Date.now.bind(Date)
let clockOffsetMs = 0
let nowSpy: MockInstance<() => number>
const LATER_MS = 10 * 60 * 1000

beforeEach(() => {
  clearAllCachedDataKeys()
  mockMaybeSingle.mockClear()
  keyRow = ROW_A
  lookupDelayMs = 0
  clockOffsetMs = 0
  nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffsetMs)
})

afterEach(() => {
  nowSpy.mockRestore()
})

describe('cached data key on load', () => {
  it('is used without a prompt when it is bound to the current key row', async () => {
    seedCache('key-A', ROW_A)
    render(<Dashboard groups={[group('g1', 'key-A', 'Work')]} />)

    expect(await screen.findByText('Work')).toBeInTheDocument()
    expect(screen.getByText('status:unlocked')).toBeInTheDocument()
    expect(screen.queryByLabelText('Encryption passphrase')).not.toBeInTheDocument()
    expect(sessionStorage.getItem(CACHE_ENTRY)).not.toBeNull()
  })

  it('is dropped when the key row was replaced, and unlocking with the new passphrase stores the new fingerprint', async () => {
    seedCache('key-A', ROW_A)
    keyRow = ROW_B
    render(<Dashboard groups={[group('g1', 'key-B', 'Work')]} />)

    expect(await screen.findByLabelText('Encryption passphrase')).toBeInTheDocument()
    expect(screen.getByText('status:locked')).toBeInTheDocument()
    expect(sessionStorage.getItem(CACHE_ENTRY)).toBeNull()
    expect(screen.queryByText('(locked)')).not.toBeInTheDocument()

    await unlockWith('second passphrase')

    expect(await screen.findByText('Work')).toBeInTheDocument()
    expect(screen.getByText('status:unlocked')).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem(CACHE_ENTRY)!)).toEqual({ key: 'b64(key-B)', fingerprint: fingerprintOf(ROW_B) })
  })

  it('still rejects the old passphrase after the key row was replaced', async () => {
    seedCache('key-A', ROW_A)
    keyRow = ROW_B
    render(<Dashboard groups={[group('g1', 'key-B', 'Work')]} />)

    await unlockWith('first passphrase')

    expect(await screen.findByText('Incorrect passphrase.')).toBeInTheDocument()
    expect(sessionStorage.getItem(CACHE_ENTRY)).toBeNull()
  })

  it('is dropped when it has no fingerprint (cached by the previous version)', async () => {
    seedCache('key-A', 'legacy')
    render(<Dashboard groups={[group('g1', 'key-A', 'Work')]} />)

    expect(await screen.findByLabelText('Encryption passphrase')).toBeInTheDocument()
    expect(screen.getByText('status:locked')).toBeInTheDocument()
    expect(sessionStorage.getItem(CACHE_ENTRY)).toBeNull()

    await unlockWith('first passphrase')

    expect(await screen.findByText('Work')).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem(CACHE_ENTRY)!)).toEqual({ key: 'b64(key-A)', fingerprint: fingerprintOf(ROW_A) })
  })

  it('is dropped, with status "no-key", when the server answers that there is no key row', async () => {
    seedCache('key-A', ROW_A)
    keyRow = null
    render(<Dashboard />)

    expect(await screen.findByText('status:no-key')).toBeInTheDocument()
    expect(sessionStorage.getItem(CACHE_ENTRY)).toBeNull()
  })

  it('is dropped on "no key row" even when it has no fingerprint', async () => {
    seedCache('key-A', 'legacy')
    keyRow = null
    render(<Dashboard />)

    expect(await screen.findByText('status:no-key')).toBeInTheDocument()
    expect(sessionStorage.getItem(CACHE_ENTRY)).toBeNull()
  })

  it('is kept when the lookup returns an error', async () => {
    seedCache('key-A', ROW_A)
    keyRow = undefined
    render(<Dashboard groups={[group('g1', 'key-A', 'Work')]} />)

    expect(await screen.findByText('Work')).toBeInTheDocument()
    expect(screen.getByText('status:unlocked')).toBeInTheDocument()
    expect(sessionStorage.getItem(CACHE_ENTRY)).not.toBeNull()
    expect(screen.queryByLabelText('Encryption passphrase')).not.toBeInTheDocument()
  })

  it('is kept when the lookup throws', async () => {
    seedCache('key-A', ROW_A)
    mockMaybeSingle.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<Dashboard groups={[group('g1', 'key-A', 'Work')]} />)

    expect(await screen.findByText('Work')).toBeInTheDocument()
    expect(screen.getByText('status:unlocked')).toBeInTheDocument()
    expect(sessionStorage.getItem(CACHE_ENTRY)).not.toBeNull()
  })

  it('is kept, even without a fingerprint, when the lookup fails', async () => {
    seedCache('key-A', 'legacy')
    keyRow = undefined
    render(<Dashboard groups={[group('g1', 'key-A', 'Work')]} />)

    expect(await screen.findByText('Work')).toBeInTheDocument()
    expect(sessionStorage.getItem(CACHE_ENTRY)).not.toBeNull()
  })
})

describe('re-check after a decrypt failure', () => {
  it('asks for the passphrase when the key row changed while the dashboard was open, after one re-check', async () => {
    seedCache('key-A', ROW_A)
    const { rerender } = render(<Dashboard groups={[group('g1', 'key-A', 'Work')]} />)
    expect(await screen.findByText('Work')).toBeInTheDocument()
    expect(keyRowChecks()).toBe(1)

    // The passphrase is reset in the extension and the groups are uploaded again under the new key.
    keyRow = ROW_B
    clockOffsetMs += LATER_MS
    rerender(<Dashboard groups={[group('g1', 'key-B', 'Work')]} />)

    expect(await screen.findByLabelText('Encryption passphrase')).toBeInTheDocument()
    expect(screen.getByText('status:locked')).toBeInTheDocument()
    expect(sessionStorage.getItem(CACHE_ENTRY)).toBeNull()
    await settle()
    expect(keyRowChecks()).toBe(2)

    await unlockWith('second passphrase')

    expect(await screen.findByText('Work')).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem(CACHE_ENTRY)!)).toEqual({ key: 'b64(key-B)', fingerprint: fingerprintOf(ROW_B) })
    await settle()
    expect(keyRowChecks()).toBe(2)
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
  })

  it('drops the key with status "no-key" when the key row was deleted while the dashboard was open', async () => {
    seedCache('key-A', ROW_A)
    const { rerender } = render(<Dashboard groups={[group('g1', 'key-A', 'Work')]} />)
    expect(await screen.findByText('Work')).toBeInTheDocument()

    keyRow = null
    clockOffsetMs += LATER_MS
    rerender(<Dashboard groups={[group('g1', 'key-B', 'Work')]} />)

    expect(await screen.findByText('status:no-key')).toBeInTheDocument()
    expect(sessionStorage.getItem(CACHE_ENTRY)).toBeNull()
  })

  it('runs a single lookup when groups and sessions fail at the same time', async () => {
    seedCache('key-A', ROW_A)
    const { rerender } = render(
      <Dashboard groups={[group('g1', 'key-A', 'Work')]} sessions={[session('s1', 'key-A', 'Monday')]} />,
    )
    expect(await screen.findByText('Work')).toBeInTheDocument()
    expect(await screen.findByText('Monday')).toBeInTheDocument()
    expect(keyRowChecks()).toBe(1)

    keyRow = ROW_B
    clockOffsetMs += LATER_MS
    lookupDelayMs = 20
    rerender(<Dashboard groups={[group('g1', 'key-B', 'Work')]} sessions={[session('s1', 'key-B', 'Monday')]} />)

    await waitFor(() => expect(screen.getAllByLabelText('Encryption passphrase')).toHaveLength(2))
    await settle()
    expect(keyRowChecks()).toBe(2)
  })

  it('re-checks a key that could not be verified on load as soon as a row fails', async () => {
    seedCache('key-A', ROW_A)
    keyRow = undefined
    const { rerender } = render(<Dashboard groups={[group('g1', 'key-B', 'Work')]} />)

    // No lookup got an answer: the key is kept, the row shows as locked, and no claim is made about
    // why. (One lookup if the failure was reported while the load check was running, two if after.)
    expect(await screen.findByText('(locked)')).toBeInTheDocument()
    await settle()
    const checksWhileOffline = keyRowChecks()
    expect(checksWhileOffline).toBeGreaterThanOrEqual(1)
    expect(checksWhileOffline).toBeLessThanOrEqual(2)
    expect(sessionStorage.getItem(CACHE_ENTRY)).not.toBeNull()
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Encryption passphrase')).not.toBeInTheDocument()

    // Back online: the next pass over the rows gets an answer.
    keyRow = ROW_B
    rerender(<Dashboard groups={[group('g1', 'key-B', 'Work')]} />)

    expect(await screen.findByLabelText('Encryption passphrase')).toBeInTheDocument()
    expect(sessionStorage.getItem(CACHE_ENTRY)).toBeNull()
    await settle()
    expect(keyRowChecks()).toBe(checksWhileOffline + 1)
  })

  it('is triggered by a device snapshot that cannot be decrypted', async () => {
    seedCache('key-A', ROW_A)
    const tree = (devices: unknown[]) => (
      <EncryptionKeyProvider>
        <Probe />
        <DevicesSection initialDevices={devices as never} userId={USER_ID} />
      </EncryptionKeyProvider>
    )
    const { rerender } = render(tree([device('d1', 'key-A')]))
    expect(await screen.findByText(/1 window · 2 tabs/)).toBeInTheDocument()
    expect(keyRowChecks()).toBe(1)

    keyRow = ROW_B
    clockOffsetMs += LATER_MS
    rerender(tree([device('d1', 'key-B')]))

    expect(await screen.findByText('status:locked')).toBeInTheDocument()
    expect(sessionStorage.getItem(CACHE_ENTRY)).toBeNull()
    await settle()
    expect(keyRowChecks()).toBe(2)
  })
})

describe('rows that stay unreadable under a verified key', () => {
  it('keeps the "(locked)" placeholder, says why inside each locked group, and does not look the key row up again', async () => {
    seedCache('key-A', ROW_A)
    const groups = [group('g1', 'key-A', 'Work'), group('g2', 'key-OLD', 'Old'), group('g3', 'key-OLD', 'Older')]
    const { rerender } = render(<Dashboard groups={groups} />)

    expect(await screen.findByText('Work')).toBeInTheDocument()
    expect(screen.getAllByText('(locked)')).toHaveLength(2)
    // One indication per locked group, none on the readable one, and no list-level note.
    const notes = await screen.findAllByText(NOTE)
    expect(notes).toHaveLength(2)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    for (const note of notes) {
      expect(note.textContent).not.toMatch(/[–—]/)
      expect(note.closest('p')!.querySelector('svg')).not.toBeNull()
      expect(note.closest('p')!.querySelector('button, a')).toBeNull()
    }
    // Each locked card's Share control is disabled and described by that card's own indication.
    const shareButtons = screen.getAllByRole('button', { name: 'Share group' })
    expect(shareButtons).toHaveLength(3)
    const disabledShare = shareButtons.filter((b) => b.getAttribute('aria-disabled') === 'true')
    expect(disabledShare).toHaveLength(2)
    const describedBy = disabledShare.map((b) => document.getElementById(b.getAttribute('aria-describedby')!))
    expect(new Set(describedBy).size).toBe(2)
    for (const el of describedBy) expect(el?.textContent).toMatch(NOTE)
    expect(screen.queryByLabelText('Encryption passphrase')).not.toBeInTheDocument()
    await settle()
    // The key was verified against the current row on load: the failures are not the key's fault.
    expect(keyRowChecks()).toBe(1)

    // A later refresh that brings the same rows back must not start a lookup either.
    clockOffsetMs += LATER_MS
    rerender(<Dashboard groups={groups.map((g) => ({ ...g }))} />)
    await settle()
    expect(keyRowChecks()).toBe(1)
    expect(screen.getByText('status:unlocked')).toBeInTheDocument()
  })

  it('checks once for a new unreadable row, keeps the key when the row still matches, and then stops', async () => {
    seedCache('key-A', ROW_A)
    const first = [group('g1', 'key-A', 'Work'), group('g2', 'key-OLD', 'Old')]
    const { rerender } = render(<Dashboard groups={first} />)
    expect(await screen.findByText(NOTE)).toBeInTheDocument()
    expect(keyRowChecks()).toBe(1)

    clockOffsetMs += LATER_MS
    const second = [...first, group('g3', 'key-OLD', 'Older')]
    rerender(<Dashboard groups={second} />)

    await waitFor(() => expect(screen.getAllByText('(locked)')).toHaveLength(2))
    await settle()
    expect(keyRowChecks()).toBe(2)
    expect(screen.getByText('status:unlocked')).toBeInTheDocument()
    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(screen.getAllByText(NOTE)).toHaveLength(2)
    expect(sessionStorage.getItem(CACHE_ENTRY)).not.toBeNull()

    clockOffsetMs += LATER_MS
    rerender(<Dashboard groups={second.map((g) => ({ ...g }))} />)
    await settle()
    expect(keyRowChecks()).toBe(2)
  })

  it('shows no note when every row decrypts', async () => {
    seedCache('key-A', ROW_A)
    render(<Dashboard groups={[group('g1', 'key-A', 'Work')]} sessions={[session('s1', 'key-A', 'Monday')]} />)

    expect(await screen.findByText('Work')).toBeInTheDocument()
    expect(await screen.findByText('Monday')).toBeInTheDocument()
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
  })

  it('says why inside a locked session, refuses to restore it, and still lets it be deleted', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
    seedCache('key-A', ROW_A)
    render(<Dashboard sessions={[session('s1', 'key-A', 'Monday'), session('s2', 'key-OLD', 'Tuesday')]} />)

    expect(await screen.findByText('Monday')).toBeInTheDocument()
    expect(screen.getByText('(locked)')).toBeInTheDocument()
    const notes = await screen.findAllByText(NOTE)
    expect(notes).toHaveLength(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await settle()
    expect(keyRowChecks()).toBe(1)

    const restoreButtons = screen.getAllByRole('button', { name: 'Restore session' })
    expect(restoreButtons).toHaveLength(2)
    const [readableRestore] = restoreButtons.filter((b) => b.getAttribute('aria-disabled') !== 'true')
    const [lockedRestore] = restoreButtons.filter((b) => b.getAttribute('aria-disabled') === 'true')
    expect(document.getElementById(lockedRestore.getAttribute('aria-describedby')!)?.textContent).toMatch(NOTE)

    fireEvent.click(lockedRestore)
    expect(openSpy).not.toHaveBeenCalled()
    fireEvent.click(readableRestore)
    expect(openSpy).toHaveBeenCalledTimes(1)

    // Delete is the user's choice even for a session that cannot be read.
    const lockedCard = screen.getByText('(locked)').closest('div.border')!
    fireEvent.click(lockedCard.querySelector('[aria-label="Delete session"]')!)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/sessions/s2', { method: 'DELETE' }))

    openSpy.mockRestore()
    fetchSpy.mockRestore()
  })

  it('says why on a device whose open tabs cannot be read, and not on a readable one', async () => {
    seedCache('key-A', ROW_A)
    render(
      <EncryptionKeyProvider>
        <DevicesSection initialDevices={[device('d1', 'key-A'), device('d2', 'key-OLD')] as never} userId={USER_ID} />
      </EncryptionKeyProvider>,
    )

    expect(await screen.findByText(/1 window · 2 tabs/)).toBeInTheDocument()
    const notes = await screen.findAllByText(NOTE)
    expect(notes).toHaveLength(1)
    expect(notes[0].closest('p')!.querySelector('svg')).not.toBeNull()
    // The note sits in the unreadable device's row, next to its name.
    expect(screen.getByText('Laptop d2').parentElement).toContainElement(notes[0])
    expect(screen.getByText('Laptop d1').parentElement).not.toContainElement(notes[0])
  })

  it('does not blame an earlier passphrase while the key could not be verified', async () => {
    seedCache('key-A', ROW_A)
    keyRow = undefined
    render(<Dashboard groups={[group('g1', 'key-B', 'Work')]} />)

    expect(await screen.findByText('(locked)')).toBeInTheDocument()
    expect(await screen.findByText(/can't be read right now/i)).toBeInTheDocument()
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share group' })).toHaveAttribute('aria-disabled', 'true')
  })
})
