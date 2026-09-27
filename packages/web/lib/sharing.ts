import { generateDataKey, encryptBlob, exportKeyToBase64 } from '@tabmerger/shared'
import { createClient } from '@/lib/supabase/client'

export interface ShareGroup {
  id: string
  name: string
  color: string
  windows: unknown[]
}

/**
 * Creates a public share bundle entirely client-side, mirroring the extension's
 * `createSharedBundle` (packages/extension/src/lib/sharing.ts) exactly so the
 * unchanged `/share/[slug]` page can decrypt either origin's snapshot the same way.
 *
 * A fresh per-share AES data key is generated in the browser, used to encrypt the
 * already-decrypted `groups` into a `{v:1,iv,ct}` envelope, and only that ciphertext
 * is inserted into `shared_bundles` via the browser Supabase client (RLS: an
 * authenticated user may insert rows with their own `user_id` — see
 * `shared_bundles_insert_owner` in supabase/migrations/009_create_shared_bundles.sql).
 * Plaintext groups and the data key never leave the browser in a network request —
 * the key is only ever embedded in the returned URL's `#key=` fragment, which
 * fragments never transmit over HTTP.
 */
export async function createSharedBundle(groups: ShareGroup[]): Promise<string> {
  if (groups.length === 0) throw new Error('No groups selected')

  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const dataKey = await generateDataKey()
  const encrypted = await encryptBlob(dataKey, groups)
  const key = await exportKeyToBase64(dataKey)
  const groups_snapshot = { v: 1, ...encrypted }

  let slug = crypto.randomUUID().replace(/-/g, '')
  let { data, error } = await supabase
    .from('shared_bundles')
    .insert({ user_id: session.user.id, groups_snapshot, slug })
    .select()
    .single()

  // Collision space is large (32 hex chars); retry once on unique-violation rather than looping.
  if (error?.code === '23505') {
    slug = crypto.randomUUID().replace(/-/g, '')
    ;({ data, error } = await supabase
      .from('shared_bundles')
      .insert({ user_id: session.user.id, groups_snapshot, slug })
      .select()
      .single())
  }

  if (error) throw new Error(error.message)

  return `${window.location.origin}/share/${data.slug}#key=${key}`
}
