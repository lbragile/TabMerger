import type { ComponentProps } from 'react'
import type { Metadata } from 'next'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { createBillingPortalSession, getPendingPlanChange, type PendingPlanChange } from '@/lib/stripe'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Link } from '@/i18n/navigation'
import { absoluteUrl, formatDate } from '@/lib/utils'
import { SubscriptionBadge } from '@/components/dashboard/SubscriptionBadge'
import { SetPasswordForm } from '@/components/account/SetPasswordForm'
import { DevicesSection } from '@/components/account/DevicesSection'
import { getEffectiveCap } from '@/lib/ai-usage'
import { BuyCreditsButton } from '@/components/account/BuyCreditsButton'
import { SwitchAiModeButton } from '@/components/account/SwitchAiModeButton'
import { CancelSubscriptionButton } from '@/components/account/CancelSubscriptionButton'
import { AI_AVAILABILITY } from '@/lib/aiFlag'
import { ACCOUNT_AI_CREDITS_ANCHOR, isAiMode } from '@tabmerger/shared'
import { SignOutForm } from '@/components/auth/SignOutForm'
import { hasCloudSync } from '@/lib/cloudSync'
import { getPlanForPriceId, getPriceInfo } from '@/lib/tiers'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account')
  return { title: t('metaTitle') }
}

export default async function AccountPage() {
  const supabase = await createClient()
  const [t, tPlan, locale, format] = await Promise.all([
    getTranslations('account'),
    getTranslations('pricing.planChange'),
    getLocale(),
    getFormatter(),
  ])
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const hasPasswordIdentity = user.identities?.some((i) => i.provider === 'email') ?? false

  const [{ data: profile }, { data: subscription }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
  ])

  const currentTier = subscription?.tier ?? 'free'
  // Single source of truth for both "grants Manage-billing / current-period display" and
  // "show sync-derived UI (devices list, real group/tab/session counts)" — matches the rest
  // of the product (active/trialing/past_due all count, not just 'active') and the RLS gate
  // in supabase/migrations/019_gate_cloud_sync_rls.sql. Free (and non-entitled paid-tier)
  // accounts never sync, so there's nothing of theirs to show either way.
  const syncEnabled = hasCloudSync(subscription)
  const isPaid = syncEnabled

  // Same row type the Devices list expects, so a mismatch fails here rather than at runtime.
  let deviceRows: ComponentProps<typeof DevicesSection>['initialDevices'] = []
  if (syncEnabled) {
    const { data: devices } = await supabase
      .from('device_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('last_active', { ascending: false })

    // ponytail: dev-only mock data — only fires in `next dev` (never in `next build`/deploy).
    // Appended alongside real rows (not just as an empty-state fallback) so the Devices UI can be
    // visually verified with a mix of real + mock devices during development.
    // Timestamps are static (not Date.now()-derived) to satisfy the render-purity lint rule.
    const mockDeviceRows = [
      { id: 'mock-1', device_id: 'mock-1', device_name: 'MacBook Pro', now_open_snapshot: null, last_active: '2026-08-05T09:58:00.000Z' },
      { id: 'mock-2', device_id: 'mock-2', device_name: 'Work Desktop', now_open_snapshot: null, last_active: '2026-08-05T07:00:00.000Z' },
      { id: 'mock-3', device_id: 'mock-3', device_name: 'Chrome on Linux', now_open_snapshot: null, last_active: '2026-07-31T10:00:00.000Z' },
    ]
    // Rows are ordered by last_active desc — same device can end up with more than one
    // device_id (e.g. extension storage cleared/reinstalled regenerates a fresh UUID), so
    // keep only the first (most recent) row per device_name to avoid listing it twice.
    const dedupedDevices = (devices ?? []).filter((d, i, arr) => arr.findIndex((x) => x.device_name === d.device_name) === i)
    deviceRows =
      process.env.NODE_ENV === 'development' ? [...dedupedDevices, ...mockDeviceRows] : dedupedDevices
  }

  // Real counts, not the old hard-coded placeholder numbers. Groups/sessions counts are
  // head:true (no row bodies, so no ciphertext ever crosses this route — see
  // encrypted-column-auditor). tab_count is a denormalized plaintext column maintained
  // client-side on every push (same column the dashboard page sums), not derived from
  // group.windows content, which is E2E ciphertext for encrypted users.
  let groupCount = 0
  let sessionCount = 0
  let tabCount = 0
  if (syncEnabled) {
    const [{ data: groupRows }, { count: sCount }] = await Promise.all([
      supabase.from('groups').select('tab_count, archived').eq('user_id', user.id),
      supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    ])
    const activeGroupRows = (groupRows ?? []).filter((g: { archived?: boolean }) => !g.archived)
    groupCount = activeGroupRows.length
    sessionCount = sCount ?? 0
    tabCount = activeGroupRows.reduce(
      (sum: number, g: { tab_count?: number }) => sum + (g.tab_count ?? 0),
      0
    )
  }

  // Pro AI's option: TabMerger's AI (monthly credits plus packs) or the subscriber's own key, which
  // TabMerger doesn't meter (the server doesn't know the key's provider until a request either).
  const isProAi = currentTier === 'pro_ai'
  const aiMode = isAiMode(subscription?.ai_mode) ? subscription.ai_mode : 'managed'
  const showAi = AI_AVAILABILITY.any
  const isOwnKey = isProAi && aiMode === 'byok'
  // Credit packs: managed Pro AI on an entitled plan, any time (not only once the month's credits
  // run out), while TabMerger's AI is on sale. The own-key option spends no credits (the checkout
  // answers 409 for it), and an ended plan has nothing to spend them against.
  const canBuyCredits = isPaid && isProAi && aiMode === 'managed' && AI_AVAILABILITY.managed
  let aiCreditsLeft = 0
  let aiCreditsLimit = 0
  if (showAi && isProAi && !isOwnKey) {
    const month = new Date().toISOString().slice(0, 7)
    const { data: usage } = await supabase
      .from('ai_usage')
      .select('credits_used')
      .eq('user_id', user.id)
      .eq('month', month)
      .maybeSingle()
    aiCreditsLimit = await getEffectiveCap(supabase, user.id, month)
    aiCreditsLeft = Math.max(0, aiCreditsLimit - (usage?.credits_used ?? 0))
  }

  let billingPortalUrl: string | null = null
  // A plan change waiting for the period end (a deferred downgrade). The portal's home page offers
  // no cancellation while one is pending, so the page shows it with its own Cancel button, which
  // opens Stripe's cancel page for this subscription.
  let pendingChange: PendingPlanChange | null = null
  if (isPaid && profile?.stripe_customer_id) {
    const customerId = profile.stripe_customer_id
    const [portal, pending] = await Promise.allSettled([
      (async () => createBillingPortalSession({ customerId, returnUrl: absoluteUrl('/account') }))(),
      (async () => (subscription?.id ? getPendingPlanChange({ customerId, subscriptionId: subscription.id }) : null))(),
    ])
    // Non-fatal: without them the portal link or the scheduled change just won't show.
    if (portal.status === 'fulfilled') billingPortalUrl = portal.value
    if (pending.status === 'fulfilled') pendingChange = pending.value
  }
  const pendingPlan = pendingChange ? getPlanForPriceId(pendingChange.priceId) : null
  // "Pro, billed monthly": the pricing page's plan-change wording.
  let pendingPlanName: string | null = null
  if (pendingPlan) {
    const name =
      pendingPlan.tierKey === 'pro'
        ? tPlan('plans.pro')
        : pendingPlan.aiMode === 'byok'
          ? tPlan('plans.proAiByok')
          : tPlan('plans.proAiManaged')
    pendingPlanName = pendingPlan.interval === 'yearly' ? tPlan('billedYearly', { plan: name }) : tPlan('billedMonthly', { plan: name })
  }

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t('lead')}
        </p>
      </div>

      {/* Usage summary — real Supabase counts, not placeholder numbers. Sync-derived cards
          (Groups synced / Tabs saved / Sessions) only render for accounts that actually sync;
          AI credits card is hidden entirely while AI features are coming soon. */}
      {(syncEnabled || showAi) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-1">
          {[
            ...(syncEnabled
              ? [
                  { id: 'groups', label: t('stats.groups'), value: String(groupCount) },
                  { id: 'tabs', label: t('stats.tabs'), value: String(tabCount) },
                  // One row count for both: which rows are automatic backups is only known after decrypting them in the browser.
                  { id: 'sessions', label: t('stats.sessions'), value: String(sessionCount) },
                ]
              : []),
            ...(!showAi
              ? []
              : isOwnKey
                ? [{ id: 'aiOwnKey', label: t('stats.aiOwnKey'), value: t('stats.aiOwnKeyValue'), accent: true }]
                : [{ id: 'aiCredits', label: t('stats.aiCredits'), value: isProAi ? format.number(aiCreditsLeft) : '0', accent: isProAi }]),
          ].map((stat, i) => (
            <div
              key={i}
              // The AI card is the extension's "Buy more credits" target (/account#ai-credits); the
              // scroll margin keeps it clear of the sticky 4rem header.
              id={stat.id === 'aiCredits' || stat.id === 'aiOwnKey' ? ACCOUNT_AI_CREDITS_ANCHOR : undefined}
              className={`scroll-mt-20 rounded-lg border p-4 ${stat.accent ? 'bg-accent border-primary/20' : 'bg-surface border-border'}`}
            >
              <p className={`font-semibold tracking-tight ${stat.accent ? 'text-primary' : ''}`} style={{ fontSize: '26px' }}>
                {stat.value}
              </p>
              <p className="text-[12px] text-text2 mt-0.5 flex items-center gap-1.5 flex-wrap">
                {stat.label}
                {/* Credit packs exist only for TabMerger's AI, and only once it's on sale. */}
                {stat.id === 'aiCredits' && canBuyCredits && <BuyCreditsButton />}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>{t('profile.title')}</CardTitle>
          <CardDescription>{t('profile.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t('profile.email')}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t('profile.memberSince')}</p>
              <p className="text-sm text-muted-foreground">
                {profile?.created_at
                  ? formatDate(profile.created_at, locale)
                  : formatDate(user.created_at, locale)}
              </p>
            </div>
          </div>
          <Separator />
          <SetPasswordForm hasPassword={hasPasswordIdentity} />
          {/* Sign-out-of-all-devices is account security, not a sync feature — free accounts
              still get it here since they don't get the Devices card below. */}
          {!syncEnabled && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{t('signOutAll.title')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('signOutAll.description')}
                  </p>
                </div>
                <SignOutForm>
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    className="w-32 hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
                  >
                    {t('signOutAll.button')}
                  </Button>
                </SignOutForm>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Subscription */}
      <Card>
        <CardHeader>
          <CardTitle>{t('subscription.title')}</CardTitle>
          <CardDescription>{t('subscription.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SubscriptionBadge
            tier={currentTier}
            status={subscription?.status}
            currentPeriodEnd={isPaid ? subscription?.current_period_end : undefined}
            priceId={subscription?.stripe_price_id}
            action={
              isPaid && billingPortalUrl ? (
                <Button variant="outline" size="sm" className="w-32" asChild>
                  <a href={billingPortalUrl}>{t('subscription.manageBilling')}</a>
                </Button>
              ) : !isPaid ? (
                <Button size="sm" asChild>
                  <Link href="/pricing">{t('subscription.upgrade')}</Link>
                </Button>
              ) : undefined
            }
          />

          {/* Pro AI: which option the subscription is on, and the switch to the other one. */}
          {showAi && isProAi && isPaid && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{t('aiPlan.title')}</p>
                <p className="text-muted-foreground">
                  {isOwnKey
                    ? t('aiPlan.byok')
                    : t('aiPlan.managed', { left: aiCreditsLeft, limit: aiCreditsLimit })}
                </p>
              </div>
              <SwitchAiModeButton
                current={aiMode}
                interval={getPriceInfo(subscription?.stripe_price_id)?.interval}
                periodEnd={subscription?.current_period_end}
                returnPath="/account"
                className="text-xs"
              />
            </div>
          )}

          {isPaid && pendingChange && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {pendingPlanName
                    ? t('subscription.scheduledChange', {
                        plan: pendingPlanName,
                        date: formatDate(new Date(pendingChange.effectiveAt * 1000), locale),
                      })
                    : t('subscription.scheduledChangeUnknownPlan', {
                        date: formatDate(new Date(pendingChange.effectiveAt * 1000), locale),
                      })}
                </p>
                <p className="text-xs text-muted-foreground">{t('subscription.scheduledCancelNote')}</p>
              </div>
              <CancelSubscriptionButton />
            </div>
          )}

          {isPaid && billingPortalUrl && !pendingChange && (
            <p className="text-xs text-muted-foreground">
              {t.rich('subscription.cancelNote', { strong: (chunks) => <strong>{chunks}</strong> })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Devices — free accounts never sync, so there's no device list to show. Sign-out is
          moved to the Profile card for them instead of duplicated here. */}
      {syncEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>{t('devicesCard.title')}</CardTitle>
            <CardDescription>
              {t('devicesCard.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DevicesSection initialDevices={deviceRows} userId={user.id} />
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t('signOutAll.title')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('signOutAll.description')}
                </p>
              </div>
              <SignOutForm>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="w-32 hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
                >
                  {t('signOutAll.button')}
                </Button>
              </SignOutForm>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
