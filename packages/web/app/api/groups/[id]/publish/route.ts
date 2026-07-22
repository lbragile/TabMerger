import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function getProUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('tier')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const tier = sub?.tier ?? 'free'
  if (tier !== 'pro' && tier !== 'pro_ai') return null
  return user
}

/**
 * Generates a public share slug for a group and writes it to the groups table.
 * Called by the extension or dashboard share button. Requires a Pro subscription.
 * Ownership is enforced by filtering on both group id and user_id — prevents other users' groups being published.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const user = await getProUser(supabase)
  if (!user) return NextResponse.json({ error: 'Pro subscription required' }, { status: 403 })

  // full UUID = 128-bit entropy; dashes stripped for cleaner URLs
  const slug = crypto.randomUUID().replace(/-/g, '')

  const { error } = await supabase
    .from('groups')
    .update({ public_slug: slug })
    .eq('id', id)
    .eq('user_id', user.id) // ownership guard

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ slug })
}

/**
 * Removes the public share slug from a group, making it private again.
 * Same auth and ownership constraints as POST — Pro only, user_id filter.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const user = await getProUser(supabase)
  if (!user) return NextResponse.json({ error: 'Pro subscription required' }, { status: 403 })

  const { error } = await supabase
    .from('groups')
    .update({ public_slug: null })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
