import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateDataKey, encryptBlob, exportKeyToBase64 } from '@tabmerger/shared'

interface ClientGroup {
  id: string
  name: string
  color: string
  windows: unknown[]
}

/**
 * Creates a public share bundle from a set of the caller's own groups.
 *
 * Groups content is now supplied by the client in plaintext, not read from
 * `groups.windows` server-side — that column is ciphertext for every E2E-encrypted
 * account (mandatory/default-on), and the server never holds the account's data
 * key, so a server-side read can only ever produce ciphertext. Wrapping that
 * ciphertext as the share payload silently double-encrypts it, crashing the
 * public share page. The client already has decrypted plaintext for its own
 * groups (dashboard already decrypted them to render), so it sends that instead.
 * A lightweight `id`-only ownership check still guards against sharing group ids
 * the caller doesn't own.
 *
 * E2E-encrypted per the key-in-URL-fragment scheme: a fresh random per-share
 * data key encrypts the group snapshot before it's written to
 * `shared_bundles.groups_snapshot` — the server never persists the key, so
 * Supabase only ever stores ciphertext. The key is returned to the client
 * once, to embed in the share link's URL fragment (never sent back to any
 * server in a request — fragments aren't transmitted over HTTP).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { groups } = (await req.json()) as { groups?: ClientGroup[] }
  if (!Array.isArray(groups) || groups.length === 0) {
    return NextResponse.json({ error: 'groups required' }, { status: 400 })
  }
  const valid = groups.every(
    (g) =>
      g &&
      typeof g.id === 'string' &&
      typeof g.name === 'string' &&
      typeof g.color === 'string' &&
      Array.isArray(g.windows)
  )
  if (!valid) {
    return NextResponse.json({ error: 'Malformed group content' }, { status: 400 })
  }

  // Ownership guard — id-only lookup, no need to read `windows` server-side anymore.
  const groupIds = groups.map((g) => g.id)
  const { data: owned, error: fetchError } = await supabase
    .from('groups')
    .select('id')
    .eq('user_id', user.id)
    .in('id', groupIds)

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  const ownedIds = new Set((owned ?? []).map((g) => g.id))
  if (ownedIds.size === 0 || !groupIds.some((id) => ownedIds.has(id))) {
    return NextResponse.json({ error: 'No matching groups' }, { status: 404 })
  }
  const shareable = groups.filter((g) => ownedIds.has(g.id))

  const dataKey = await generateDataKey()
  const encrypted = await encryptBlob(dataKey, shareable)
  const key = await exportKeyToBase64(dataKey)

  const slug = crypto.randomUUID().replace(/-/g, '')
  const { error: insertError } = await supabase.from('shared_bundles').insert({
    slug,
    user_id: user.id,
    groups_snapshot: { v: 1, ...encrypted },
  })

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  return NextResponse.json({ slug, key })
}
