import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { resumeHook } from 'workflow/api'
import type { ReorganizeAction } from '@/lib/workflows/tabOrganizer'

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceRoleClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token)

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('tier, status')
    .eq('user_id', user.id)
    .single()

  if (subscription?.tier !== 'pro_ai' || subscription?.status !== 'active') {
    return NextResponse.json(
      { error: 'Pro AI subscription required' },
      { status: 403 }
    )
  }

  const body: { token: string; approved: boolean; actions?: ReorganizeAction[] } =
    await request.json()

  // Verify token belongs to the authenticated user — token format is `org-${userId}-${random}` (Issue 2 — IDOR fix)
  if (!body.token.startsWith(`org-${user.id}-`)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await resumeHook(body.token, { approved: body.approved, actions: body.actions })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('AI organize approve error:', err)
    return NextResponse.json(
      { error: 'Failed to resume workflow' },
      { status: 500 }
    )
  }
}
