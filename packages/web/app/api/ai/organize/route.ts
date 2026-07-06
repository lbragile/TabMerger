import { randomBytes } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { start, getRun } from 'workflow/api'
import { tabOrganizerWorkflow } from '@/lib/workflows/tabOrganizer'

async function getAuthenticatedUser(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token) return { token: null, user: null, supabase: null }

  const supabase = await createServiceRoleClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)

  if (error || !user) return { token, user: null, supabase }
  return { token, user, supabase }
}

async function checkProAiSubscription(
  supabase: Awaited<ReturnType<typeof createServiceRoleClient>>,
  userId: string
) {
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('tier, status')
    .eq('user_id', userId)
    .single()

  return subscription?.tier === 'pro_ai' && subscription?.status === 'active'
}

export async function POST(request: NextRequest) {
  const { token, user, supabase } = await getAuthenticatedUser(request)

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!user || !supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hasAccess = await checkProAiSubscription(supabase, user.id)
  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Pro AI subscription required' },
      { status: 403 }
    )
  }

  try {
    const hookToken = `org-${user.id}-${randomBytes(16).toString('hex')}`
    const run = await start(tabOrganizerWorkflow, [user.id, hookToken])

    // Store runId → userId so the GET stream can verify ownership (Issue 3)
    await supabase.from('organize_runs').insert({ run_id: run.runId, user_id: user.id })

    return NextResponse.json({ runId: run.runId, token: hookToken })
  } catch (err) {
    console.error('AI organize start error:', err)
    return NextResponse.json(
      { error: 'Failed to start workflow' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  const { token, user, supabase } = await getAuthenticatedUser(request)

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!user || !supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hasAccess = await checkProAiSubscription(supabase, user.id)
  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Pro AI subscription required' },
      { status: 403 }
    )
  }

  const { searchParams } = new URL(request.url)
  const runId = searchParams.get('runId')

  if (!runId) {
    return NextResponse.json({ error: 'runId required' }, { status: 400 })
  }

  // Verify the runId belongs to the authenticated user (Issue 3 — IDOR fix)
  const { data: runRecord } = await supabase
    .from('organize_runs')
    .select('user_id')
    .eq('run_id', runId)
    .single()

  if (!runRecord || runRecord.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const readable = await getRun(runId).getReadable()
    return new Response(readable, {
      headers: { 'Content-Type': 'application/x-ndjson' },
    })
  } catch (err) {
    console.error('AI organize stream error:', err)
    return NextResponse.json(
      { error: 'Failed to stream workflow' },
      { status: 500 }
    )
  }
}
