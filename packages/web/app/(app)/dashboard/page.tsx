import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { StatsOverview } from '@/components/dashboard/StatsOverview'
import { SubscriptionBadge } from '@/components/dashboard/SubscriptionBadge'
import { SessionList } from '@/components/dashboard/SessionList'
import { GroupGrid } from '@/components/dashboard/GroupGrid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { OrganizeProposal } from '@/components/dashboard/OrganizeProposal'
import { OnboardingChecklist } from '@/components/dashboard/OnboardingChecklist'
import { Sparkles, Plus } from 'lucide-react'

// ponytail: capitalize the whole email local-part as a first name proxy — no profile
// display-name column exists yet, and splitting on '.' would mangle names like "mary.jane"
function firstNameFromEmail(email: string) {
  const local = email.split('@')[0] ?? ''
  return local.charAt(0).toUpperCase() + local.slice(1)
}

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

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const currentTier = (subscription?.tier as 'free' | 'pro' | 'pro_ai') ?? 'free'
  const isPro = currentTier === 'pro' || currentTier === 'pro_ai'

  const [
    { data: profile },
    { data: groups },
    { data: sessions },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    /** Free tier cap enforced at the query level so the UI never accidentally renders groups the user shouldn't see */
    supabase.from('groups').select('id, name, color, windows, updated_at, public_slug').eq('user_id', user.id).order('position').limit(isPro ? 1000 : 5),
    supabase
      .from('sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
  ])

  const tabCount = (groups ?? []).reduce(
    (sum: number, g: { windows?: { tabs?: unknown[] }[] }) =>
      sum + (g.windows ?? []).reduce((ws: number, w) => ws + (w.tabs?.length ?? 0), 0),
    0
  )

  let aiUsage: { used: number; limit: number } | undefined
  if (currentTier === 'pro_ai') {
    const month = new Date().toISOString().slice(0, 7)
    const { data: usage } = await supabase
      .from('ai_usage')
      .select('request_count')
      .eq('user_id', user.id)
      .eq('month', month)
      .single()
    // ponytail: 100/month cap is hardcoded per the migration comment — no plan-limits table yet
    aiUsage = { used: usage?.request_count ?? 0, limit: 100 }
  }

  const { organizeRunId, organizeToken } = params
  let organizeSession: string | null = null
  if (organizeRunId && organizeToken) {
    /** OrganizeProposal is a client component and can't read server cookies, so we pass the JWT down as a prop */
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

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold">Good morning, {firstNameFromEmail(user.email ?? '')}</h1>
            <Badge variant="secondary" className="capitalize">
              {currentTier === 'pro_ai' ? 'Pro AI' : currentTier}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* ponytail: no web-initiated organize trigger exists yet — the extension starts the
              workflow and deep-links back here with organizeRunId/organizeToken. Point users there.
              Disabled buttons don't fire hover events, so the tooltip trigger wraps the button in
              a span rather than relying on a native title attribute (which silently never fires). */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={currentTier !== 'pro_ai' ? 0 : undefined}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentTier !== 'pro_ai'}
                  >
                    <Sparkles className="h-4 w-4 mr-1.5" />
                    AI organise
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {currentTier !== 'pro_ai' ? 'Upgrade to Pro AI to use AI organise' : 'Start this from the TabMerger extension popup'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* ponytail: no web group-creation API — groups are authored in the extension only */}
          <Button size="sm" title="Create groups from the extension">
            <Plus className="h-4 w-4 mr-1.5" />
            New group
          </Button>
        </div>
      </div>

      <OnboardingChecklist isSignedIn={!!user} isPro={isPro} />

      <StatsOverview
        tabCount={tabCount}
        groupCount={groups?.length ?? 0}
        sessionCount={sessions?.length ?? 0}
        memberSince={profile?.created_at ?? user.created_at}
        aiUsage={aiUsage}
      />

      <SubscriptionBadge
        tier={currentTier}
        status={subscription?.status}
        currentPeriodEnd={subscription?.current_period_end}
        priceId={subscription?.stripe_price_id}
      />

      {organizeRunId && organizeToken && organizeSession && (
        <OrganizeProposal
          runId={organizeRunId}
          token={organizeToken}
          supabaseToken={organizeSession}
        />
      )}

      <div>
        <h2 className="text-lg font-semibold mb-4">Tab Groups</h2>
        {/* ponytail: cast because Supabase infers windows as Json, not ExtWindow[] */}
        <GroupGrid groups={(groups ?? []) as never} isPro={isPro} />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Saved Sessions</h2>
        <SessionList sessions={sessions ?? []} isPro={isPro} />
      </div>
    </div>
  )
}
