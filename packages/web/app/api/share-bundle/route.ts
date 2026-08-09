import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateDataKey, encryptBlob, exportKeyToBase64 } from '@tabmerger/shared'

/**
 * Creates a public share bundle from a set of the caller's own groups.
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

  const { groupIds } = (await req.json()) as { groupIds?: string[] }
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    return NextResponse.json({ error: 'groupIds required' }, { status: 400 })
  }

  const { data: groups, error: fetchError } = await supabase
    .from('groups')
    .select('id, name, color, windows')
    .eq('user_id', user.id) // ownership guard — only the caller's own groups can be bundled
    .in('id', groupIds)

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!groups || groups.length === 0) {
    return NextResponse.json({ error: 'No matching groups' }, { status: 404 })
  }

  const dataKey = await generateDataKey()
  const encrypted = await encryptBlob(dataKey, groups)
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
