import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** The only shape a `sessions.id` has: the extension's short ids and UUIDs both fit. */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Deletes a saved session or an automatic backup (both are rows of `sessions`) by ID. Called by
 * the dashboard's session list and Backups section.
 * The id comes from the URL, so its shape is checked before anything else: a value that is not a
 * plain id gets a 400 and never reaches Supabase.
 * RLS on the sessions table would catch cross-user deletes, but the explicit user_id filter
 * is a defence-in-depth guard that also avoids a full-table scan on the RLS check.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    // The Postgres wording can name tables, columns and policies, so it stays in the server log.
    console.error('Session delete error:', error)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}
