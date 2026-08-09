import { nanoid } from 'nanoid'
import { generateDataKey, encryptBlob, exportKeyToBase64 } from '@tabmerger/shared'
import type { Group } from './types'

export interface Entitlement {
  tier: string
  sharing: boolean
}

/**
 * Creates a public share bundle by inserting the selected groups (encrypted)
 * into the `shared_bundles` table. Requires an active Supabase session (Pro
 * entitlement). Matches the web dashboard's share-bundle scheme: a fresh
 * random per-share AES key encrypts the snapshot client-side into
 * `{v:1,iv,ct}` before insert, and the key is embedded only in the returned
 * URL's `#key=` fragment — it's never sent to the server and never persisted.
 */
export async function createSharedBundle(
  groupIds: string[],
  groups: Group[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient: any,
  entitlements?: Entitlement
): Promise<string> {
  if (groupIds.length === 0) throw new Error('No groups selected')

  const { data: { session } } = await supabaseClient.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  if (entitlements && !entitlements.sharing) {
    throw new Error('Sharing requires a Pro upgrade — entitlement not met')
  }

  const selected = groups.filter((g) => groupIds.includes(g.id))

  const dataKey = await generateDataKey()
  const encrypted = await encryptBlob(dataKey, selected)
  const key = await exportKeyToBase64(dataKey)
  const groups_snapshot = { v: 1, ...encrypted }

  let slug = nanoid(10)
  let { data, error } = await supabaseClient
    .from('shared_bundles')
    .insert({ user_id: session.user.id, groups_snapshot, slug })
    .select()
    .single()

  // ponytail: collision space is 62^10, retry once on unique-violation rather than looping
  if (error?.code === '23505') {
    slug = nanoid(10)
    ;({ data, error } = await supabaseClient
      .from('shared_bundles')
      .insert({ user_id: session.user.id, groups_snapshot, slug })
      .select()
      .single())
  }

  if (error) throw new Error(error.message)

  const base = import.meta.env.VITE_WEB_APP_URL ?? 'https://tabmerger.vercel.app'
  return `${base}/share/${data.slug}#key=${key}`
}
