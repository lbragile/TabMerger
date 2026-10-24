import type { ComponentProps } from 'react'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { StatsOverview } from '@/components/dashboard/StatsOverview'
import { SubscriptionBadge } from '@/components/dashboard/SubscriptionBadge'
import { SessionList } from '@/components/dashboard/SessionList'
import { BackupsSection } from '@/components/dashboard/BackupsSection'
import { SavedSessionsProvider } from '@/components/dashboard/SavedSessionsProvider'
import { SessionsStatDescription, SessionsStatValue } from '@/components/dashboard/SessionsStat'
import { GroupGrid } from '@/components/dashboard/GroupGrid'
import { Badge } from '@/components/ui/badge'
import { OrganizeProposal } from '@/components/dashboard/OrganizeProposal'
import { OnboardingChecklist } from '@/components/dashboard/OnboardingChecklist'
import { UpgradedBanner } from '@/components/dashboard/UpgradedBanner'
import { getEffectiveCap } from '@/lib/ai-usage'
import { AUTO_BACKUP_DOWNLOAD_LIMITS, isAiMode, isEncryptedBlob } from '@tabmerger/shared'
import { AI_AVAILABILITY } from '@/lib/aiFlag'
import { SwitchAiModeButton } from '@/components/account/SwitchAiModeButton'
import { hasCloudSync } from '@/lib/cloudSync'
import { getPriceInfo } from '@/lib/tiers'
import { getStoreLinks } from '@/lib/storeLinks'
import { getVisitorBrowser } from '@/lib/visitorBrowser'

// ponytail: capitalize the whole email local-part as a first name proxy — no profile
// display-name column exists yet, and splitting on '.' would mangle names like "mary.jane"
function firstNameFromEmail(email: string) {
  const local = email.split('@')[0] ?? ''
  return local.charAt(0).toUpperCase() + local.slice(1)
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard')
  return { title: t('metaTitle') }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ upgraded?: string; organizeRunId?: string; organizeToken?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const [t, tierNames] = await Promise.all([getTranslations('dashboard'), getTranslations('pricing.tierNames')])
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
  const syncEnabled = hasCloudSync(subscription)

  const [
    { data: profile },
    { data: groups },
    { data: sessions, error: sessionsError, count: sessionsTotal },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    // Free (and non-entitled paid-tier) accounts never sync — RLS rejects their writes
    // (supabase/migrations/019_gate_cloud_sync_rls.sql), so there's nothing of theirs to read.
    syncEnabled
      ? supabase
          .from('groups')
          .select('id, name, color, windows, updated_at, window_count, tab_count, archived')
          .eq('user_id', user.id)
          .order('position')
          .limit(isPro ? 1000 : 5)
      : Promise.resolve({ data: null }),
    // Read for every account: RLS lets the owner read and delete their rows at any plan, so an
    // account that lost cloud sync still sees (read-only) the sessions and backups it saved before.
    // Only INSERT/UPDATE need has_cloud_sync(), and the dashboard never writes these rows.
    // `count: 'exact'` returns the full row total in the same request, so the "Sessions stored"
    // stat isn't capped at the row limit below.
    supabase
      .from('sessions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(AUTO_BACKUP_DOWNLOAD_LIMITS.rows),
  ])

  // ponytail: uses the denormalized tab_count column (maintained client-side on every push),
  // not group.windows content — windows is ciphertext for encrypted users and the server
  // never holds the key to reduce over it. Stats exclude archived groups, matching the
  // extension's SidePanel behavior.
  const activeGroups = (groups ?? []).filter((g: { archived?: boolean }) => !g.archived)
  const tabCount = activeGroups.reduce(
    (sum: number, g: { tab_count?: number }) => sum + (g.tab_count ?? 0),
    0
  )

  // Pro AI's option: TabMerger's AI (credits) or the subscriber's own key (no credits to show).
  const aiMode = isAiMode(subscription?.ai_mode) ? subscription.ai_mode : 'managed'
  const aiSwitch = (
    <SwitchAiModeButton
      current={aiMode}
      interval={getPriceInfo(subscription?.stripe_price_id)?.interval}
      periodEnd={subscription?.current_period_end}
      returnPath="/dashboard"
    />
  )
  let aiUsage: ComponentProps<typeof StatsOverview>['aiUsage']
  if (AI_AVAILABILITY.any && currentTier === 'pro_ai') {
    if (aiMode === 'byok') {
      aiUsage = { mode: 'byok', action: aiSwitch }
    } else {
      const month = new Date().toISOString().slice(0, 7)
      const { data: usage } = await supabase
        .from('ai_usage')
        .select('credits_used')
        .eq('user_id', user.id)
        .eq('month', month)
        .single()
      aiUsage = {
        mode: 'managed',
        used: usage?.credits_used ?? 0,
        limit: await getEffectiveCap(supabase, user.id, month),
        action: aiSwitch,
      }
    }
  }

  const { organizeRunId, organizeToken } = params
  let organizeSession: string | null = null
  if (AI_AVAILABILITY.any && organizeRunId && organizeToken) {
    /** OrganizeProposal is a client component and can't read server cookies, so we pass the JWT down as a prop */
    const { data: { session } } = await supabase.auth.getSession()
    organizeSession = session?.access_token ?? null
  }

  return (
    // One decrypt pass for everything below that lists or counts `sessions` rows: saved sessions
    // and automatic backups are the same table and can only be told apart after decrypting.
    <SavedSessionsProvider sessions={(sessions ?? []) as never} loadError={!!sessionsError}>
    <div className="flex flex-col gap-8">
      {params.upgraded === '1' && (
        <UpgradedBanner planName={subscription?.tier === 'pro_ai' ? tierNames('proAi') : tierNames('pro')} />
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold">{t('greeting', { name: firstNameFromEmail(user.email ?? '') })}</h1>
        <Badge
          variant={currentTier === 'pro' ? 'default' : 'secondary'}
          className="capitalize rounded-md"
        >
          {t(`tierBadge.${currentTier}`)}
        </Badge>
      </div>

      <OnboardingChecklist isSignedIn={!!user} isPro={isPro} installHref={getStoreLinks()[await getVisitorBrowser()]} />

      <StatsOverview
        tabCount={tabCount}
        groupCount={activeGroups.length}
        sessionCount={sessionsTotal ?? sessions?.length ?? 0}
        sessionStat={{ value: <SessionsStatValue />, description: <SessionsStatDescription /> }}
        memberSince={profile?.created_at ?? user.created_at}
        aiUsage={aiUsage}
        showSyncStats={syncEnabled}
      />

      <SubscriptionBadge
        tier={currentTier}
        status={subscription?.status}
        currentPeriodEnd={subscription?.current_period_end}
        priceId={subscription?.stripe_price_id}
      />

      {AI_AVAILABILITY.any && organizeRunId && organizeToken && organizeSession && (
        <OrganizeProposal
          runId={organizeRunId}
          token={organizeToken}
          supabaseToken={organizeSession}
          encrypted={(groups ?? []).some((g: { windows?: unknown }) => isEncryptedBlob(g.windows))}
        />
      )}

      {syncEnabled && (
        <div>
          <h2 className="text-lg font-semibold mb-4">{t('tabGroups')}</h2>
          {/* ponytail: cast because Supabase infers windows as Json, not ExtWindow[] */}
          <GroupGrid groups={(groups ?? []) as never} isPro={isPro} />
        </div>
      )}

      {/* An account without cloud sync sees this only when it still has rows saved from before, read-only. */}
      {(syncEnabled || (sessions?.length ?? 0) > 0) && (
        <div>
          <h2 className="text-lg font-semibold mb-4">{t('savedSessions')}</h2>
          {/* The rows come from SavedSessionsProvider above. */}
          <SessionList isPro={isPro} readOnly={!syncEnabled} />
        </div>
      )}

      {/* Shown to every account: one without cloud sync gets the upgrade link, plus any backups it
          still has, read-only (download and delete). */}
      <BackupsSection syncEnabled={syncEnabled} />
    </div>
    </SavedSessionsProvider>
  )
}
