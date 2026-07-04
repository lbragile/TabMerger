import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { groupTabs, type Tab } from '@/lib/ai'

export async function POST(request: NextRequest) {
  // Extract Bearer token and verify Pro AI subscription
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
  const tabs: Tab[] = body.tabs

  if (!Array.isArray(tabs) || tabs.length === 0) {
    return NextResponse.json({ error: 'tabs array required' }, { status: 400 })
  }

  try {
    const groups = await groupTabs(tabs)
    return NextResponse.json({ groups })
  } catch (err) {
    console.error('AI group-tabs error:', err)
    return NextResponse.json(
      { error: 'Failed to group tabs' },
      { status: 500 }
    )
  }
}
