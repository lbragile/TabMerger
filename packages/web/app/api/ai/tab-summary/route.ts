import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { summarizeTab, type Tab } from '@/lib/ai'

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

  const body = await request.json()
  const tab: Tab = body.tab

  if (!tab || typeof tab.id !== 'number') {
    return NextResponse.json({ error: 'tab object required' }, { status: 400 })
  }

  try {
    const summary = await summarizeTab(tab)
    return NextResponse.json({ summary })
  } catch (err) {
    console.error('AI tab-summary error:', err)
    return NextResponse.json(
      { error: 'Failed to summarize tab' },
      { status: 500 }
    )
  }
}
