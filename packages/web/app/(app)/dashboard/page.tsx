import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { StatsOverview } from '@/components/dashboard/StatsOverview'
import { SubscriptionBadge } from '@/components/dashboard/SubscriptionBadge'
import { SessionList } from '@/components/dashboard/SessionList'
import { Badge } from '@/components/ui/badge'
import { OrganizeProposal } from '@/components/dashboard/OrganizeProposal'

export const metadata: Metadata = {
  title: 'Dashboard',
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ upgraded?: string; organizeRunId?: string; organizeToken?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const [
    { data: profile },
    { data: subscription },
    { data: groups },
    { data: sessions },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
    supabase.from('groups').select('id').eq('user_id', user.id),
    supabase
      .from('sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
  ])

  const currentTier = (subscription?.tier as 'free' | 'pro' | 'pro_ai') ?? 'free'
  const isPro = currentTier === 'pro' || currentTier === 'pro_ai'

  const { organizeRunId, organizeToken } = params
  let organizeSession: string | null = null
  if (organizeRunId && organizeToken) {
    const { data: { session } } = await supabase.auth.getSession()
    organizeSession = session?.access_token ?? null
  }

  return (
    <div className="flex flex-col gap-8">
      {params.upgraded === '1' && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          Welcome to {subscription?.tier === 'pro_ai' ? 'Pro AI' : 'Pro'}!
          Your subscription is now active. Enjoy your new features.
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <Badge variant="secondary" className="capitalize">
            {currentTier === 'pro_ai' ? 'Pro AI' : currentTier}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Welcome back, {user.email}
        </p>
      </div>

      <StatsOverview
        groupCount={groups?.length ?? 0}
        sessionCount={sessions?.length ?? 0}
        memberSince={profile?.created_at ?? user.created_at}
      />

      <SubscriptionBadge
        tier={currentTier}
        status={subscription?.status}
        currentPeriodEnd={subscription?.current_period_end}
      />

      {organizeRunId && organizeToken && organizeSession && (
        <OrganizeProposal
          runId={organizeRunId}
          token={organizeToken}
          supabaseToken={organizeSession}
        />
      )}

      <div>
        <h2 className="text-lg font-semibold mb-4">Saved Sessions</h2>
        <SessionList sessions={sessions ?? []} isPro={isPro} />
      </div>
    </div>
  )
}
