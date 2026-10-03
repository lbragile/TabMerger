import { decryptBlob, encryptBlob, isEncryptedBlob, type EncryptedBlob } from '@tabmerger/shared'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { setupEncryption, getDataKey } from '@/lib/encryptionKey'

/**
 * Helpers for the REAL-network suites (local Supabase stack). Group content is only ever uploaded
 * encrypted, so a suite that pushes groups must give its test account a key first, and reads what
 * reached the server through `readableRow`.
 */
export const TEST_PASSPHRASE = 'integration-test-passphrase-do-not-use-in-prod'

/** Gives the signed-in test account a fresh key. Setup only INSERTs, so a leftover row goes first. */
export async function setupFreshEncryption(userId: string): Promise<void> {
  await removeEncryption(userId)
  await setupEncryption(TEST_PASSPHRASE)
}

export async function removeEncryption(userId: string): Promise<void> {
  await supabase.from('encryption_keys').delete().eq('user_id', userId)
}

type Content = { name: string; windows: unknown; note?: string | null; info?: string }

async function accountKey(): Promise<CryptoKey> {
  const key = await getDataKey()
  if (!key) throw new Error('test account has no unlocked data key: call setupFreshEncryption first')
  return key
}

/** A raw `groups` row as its owner reads it: content decrypted when the row is ciphertext. */
export async function readableRow<T extends Record<string, unknown>>(row: T | null): Promise<(T & Content) | null> {
  if (!row) return null
  if (!isEncryptedBlob(row.windows)) return row as T & Content
  const content = await decryptBlob<Content>(await accountKey(), row.windows as EncryptedBlob)
  return { ...row, ...content }
}

/**
 * "Another device of the same account" changes a row's content: it holds the same data key, so it
 * re-encrypts the content with the patch applied (a plaintext `name` update would be ignored by
 * readers, which take the content from the blob).
 */
export async function editRowContentAs(client: SupabaseClient, id: string, patch: Partial<Content>): Promise<{ error: unknown }> {
  const { data, error } = await client.from('groups').select('*').eq('id', id).maybeSingle()
  if (error || !data) return { error: error ?? new Error(`row ${id} not found`) }
  const current = (await readableRow(data as Record<string, unknown>))!
  const next: Content = { name: current.name, windows: current.windows, note: current.note, info: current.info, ...patch }
  const { iv, ct } = await encryptBlob(await accountKey(), next)
  const res = await client.from('groups').update({ windows: { v: 1, iv, ct } }).eq('id', id)
  return { error: res.error }
}
