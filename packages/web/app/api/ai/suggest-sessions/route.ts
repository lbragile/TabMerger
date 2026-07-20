import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { suggestSessions, type Tab } from '@/lib/ai'
import { checkAndIncrementAIUsage } from '@/lib/ai-usage'

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

  const { allowed, remaining } = await checkAndIncrementAIUsage(supabase, user.id)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Pro AI subscription required or monthly limit reached' },
      { status: remaining === 0 ? 429 : 403 }
    )
  }

  const body = await request.json()
  const groups: { name: string; tabs: Tab[] }[] = body.groups

  if (!Array.isArray(groups) || groups.length === 0) {
    return NextResponse.json({ error: 'groups array required' }, { status: 400 })
  }

  try {
    const suggestion = await suggestSessions(groups)
    return NextResponse.json({ suggestion }, {
      headers: { 'X-AI-Requests-Remaining': String(remaining) },
    })
  } catch (err) {
    console.error('AI suggest-sessions error:', err)
    return NextResponse.json(
      { error: 'Failed to suggest sessions' },
      { status: 500 }
    )
  }
}
