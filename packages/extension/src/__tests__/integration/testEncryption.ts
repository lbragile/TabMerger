import { generateDataKey, decryptBlob, encryptBlob, isEncryptedBlob, type EncryptedBlob } from '@tabmerger/shared'
import { fakeRemote, type RemoteRow } from './fakeSupabase'

/**
 * Test-only: a real AES data key for the fake-network integration suites. Content is only ever
 * uploaded encrypted, so these suites mock `@/lib/encryptionKey` as "key present and unlocked"
 * with this key, and read what reached the fake server through the helpers below.
 */
// On `globalThis` (like the fake remote) so it survives `vi.resetModules()`: a simulated second
// context / worker restart must still hold the SAME account key.
const holder = globalThis as unknown as { __tmTestDataKey?: Promise<CryptoKey> }
export const testDataKey = (): Promise<CryptoKey> => (holder.__tmTestDataKey ??= generateDataKey())

type Content = { name: string; windows: unknown; note?: string | null; info?: string }

/** A remote row as its owner reads it: content columns decrypted when the row is ciphertext. */
export async function plainRow(row: RemoteRow | undefined): Promise<(RemoteRow & Content) | undefined> {
  if (!row) return undefined
  if (!isEncryptedBlob(row.windows)) return row as RemoteRow & Content
  const content = await decryptBlob<Content>(await testDataKey(), row.windows as EncryptedBlob)
  return { ...row, ...content }
}

/** Rewrites a remote row as the app stores it: content in the encrypted blob, plaintext columns blank. */
export async function encryptRemoteRow(id: string): Promise<void> {
  const row = fakeRemote.rows.get(id)
  if (!row || isEncryptedBlob(row.windows)) return
  const { iv, ct } = await encryptBlob(await testDataKey(), { name: row.name, windows: row.windows, note: row.note, info: row.info })
  fakeRemote.rows.set(id, { ...row, name: '', note: null, info: '', windows: { v: 1, iv, ct } })
}

/** Decrypted `name` of one remote row. */
export const remoteName = async (id: string): Promise<string | undefined> => (await plainRow(fakeRemote.rows.get(id)))?.name

/** Decrypted names of every remote row, in table order. */
export const remoteNames = async (): Promise<string[]> =>
  Promise.all([...fakeRemote.rows.values()].map(async (r) => (await plainRow(r))!.name))
