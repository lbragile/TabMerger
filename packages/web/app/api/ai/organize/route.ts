import { randomBytes } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { start, getRun } from 'workflow/api'
import { tabOrganizerWorkflow } from '@/lib/workflows/tabOrganizer'
import { checkAndIncrementAIUsage } from '@/lib/ai-usage'

/**
 * Extracts and validates the caller's identity from the Authorization header.
 * The extension passes its Supabase JWT as a Bearer token because it runs on a different origin
 * and cannot share cookies; the service role client is needed to verify an arbitrary JWT.
 */
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


/**
 * Starts a durable tab-organizer workflow and returns a runId + hookToken.
 * Enforces Pro AI entitlement and records the runId → userId mapping so the GET handler
 * can verify ownership before streaming results back.
 */
export async function POST(request: NextRequest) {
  const { token, user, supabase } = await getAuthenticatedUser(request)

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!user || !supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { allowed, remaining } = await checkAndIncrementAIUsage(supabase, user.id)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Pro AI subscription required or monthly limit reached' },
      { status: remaining === 0 ? 429 : 403 }
    )
  }

  try {
    const hookToken = `org-${user.id}-${randomBytes(16).toString('hex')}`
    const run = await start(tabOrganizerWorkflow, [user.id, hookToken])

    // Store runId → userId so the GET stream can verify ownership (Issue 3)
    await supabase.from('organize_runs').insert({ run_id: run.runId, user_id: user.id })

    return NextResponse.json({ runId: run.runId, token: hookToken }, {
      headers: { 'X-AI-Requests-Remaining': String(remaining) },
    })
  } catch (err) {
    console.error('AI organize start error:', err)
    return NextResponse.json(
      { error: 'Failed to start workflow' },
      { status: 500 }
    )
  }
}

/**
 * Streams NDJSON progress events for a running workflow identified by runId.
 * Verifies the runId belongs to the authenticated user before streaming to prevent IDOR.
 */
export async function GET(request: NextRequest) {
  const { token, user, supabase } = await getAuthenticatedUser(request)

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!user || !supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { allowed } = await checkAndIncrementAIUsage(supabase, user.id)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Pro AI subscription required or monthly limit reached' },
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
