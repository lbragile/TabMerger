import type { ComponentProps } from 'react'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createBillingPortalSession } from '@/lib/stripe'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import Link from 'next/link'
import { absoluteUrl, formatDate } from '@/lib/utils'
import { SubscriptionBadge } from '@/components/dashboard/SubscriptionBadge'
import { SetPasswordForm } from '@/components/account/SetPasswordForm'
import { DevicesSection } from '@/components/account/DevicesSection'
import { getEffectiveCap } from '@/lib/ai-usage'
import { BuyCreditsButton } from '@/components/account/BuyCreditsButton'
import { AI_ENABLED } from '@/lib/aiFlag'
import { SignOutForm } from '@/components/auth/SignOutForm'
import { hasCloudSync } from '@/lib/cloudSync'

export const metadata: Metadata = {
  title: 'Account',
}

export default async function AccountPage() {
  const supabase = await createClient()
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

  let aiCreditsLeft = 0
  if (AI_ENABLED && currentTier === 'pro_ai') {
    const month = new Date().toISOString().slice(0, 7)
    const { data: usage } = await supabase
      .from('ai_usage')
      .select('credits_used')
      .eq('user_id', user.id)
      .eq('month', month)
      .maybeSingle()
    const cap = await getEffectiveCap(supabase, user.id, month)
    aiCreditsLeft = cap - (usage?.credits_used ?? 0)
  }

  let billingPortalUrl: string | null = null
  if (isPaid && profile?.stripe_customer_id) {
    try {
      billingPortalUrl = await createBillingPortalSession({
        customerId: profile.stripe_customer_id,
        returnUrl: absoluteUrl('/account'),
      })
    } catch {
      // non-fatal — portal link just won't show
    }
  }

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Account settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage your account and subscription.
        </p>
      </div>

      {/* Usage summary — real Supabase counts, not placeholder numbers. Sync-derived cards
          (Groups synced / Tabs saved / Sessions) only render for accounts that actually sync;
          AI credits card is hidden entirely while AI features are coming soon. */}
      {(syncEnabled || AI_ENABLED) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-1">
          {[
            ...(syncEnabled
              ? [
                  { label: 'Groups synced', value: String(groupCount) },
                  { label: 'Tabs saved', value: String(tabCount) },
                  { label: 'Sessions', value: String(sessionCount) },
                ]
              : []),
            ...(AI_ENABLED
              ? [{ label: 'AI credits left', value: currentTier === 'pro_ai' ? String(aiCreditsLeft) : '0', accent: currentTier === 'pro_ai' }]
              : []),
          ].map((stat, i) => (
            <div
              key={i}
              className={`rounded-lg border p-4 ${stat.accent ? 'bg-accent border-primary/20' : 'bg-surface border-border'}`}
            >
              <p className={`font-semibold tracking-tight ${stat.accent ? 'text-primary' : ''}`} style={{ fontSize: '26px' }}>
                {stat.value}
              </p>
              <p className="text-[12px] text-text2 mt-0.5 flex items-center gap-1.5 flex-wrap">
                {stat.label}
                {stat.label === 'AI credits left' && currentTier === 'pro_ai' && aiCreditsLeft <= 0 && (
                  <BuyCreditsButton />
                )}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your account information.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Email</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Member since</p>
              <p className="text-sm text-muted-foreground">
                {profile?.created_at
                  ? formatDate(profile.created_at)
                  : formatDate(user.created_at)}
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
                  <p className="text-sm font-medium">Sign out of all devices</p>
                  <p className="text-xs text-muted-foreground">
                    This will revoke all active sessions.
                  </p>
                </div>
                <SignOutForm>
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    className="w-32 hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
                  >
                    Sign out
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
          <CardTitle>Subscription</CardTitle>
          <CardDescription>Manage your plan and billing.</CardDescription>
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
                  <a href={billingPortalUrl}>Manage billing</a>
                </Button>
              ) : !isPaid ? (
                <Button size="sm" asChild>
                  <Link href="/pricing">Upgrade</Link>
                </Button>
              ) : undefined
            }
          />

          {isPaid && billingPortalUrl && (
            <p className="text-xs text-muted-foreground">
              You can cancel anytime via <strong>Manage billing</strong>. You keep access until the end of your current billing period.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Devices — free accounts never sync, so there's no device list to show. Sign-out is
          moved to the Profile card for them instead of duplicated here. */}
      {syncEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>Devices</CardTitle>
            <CardDescription>
              Devices syncing your groups and tabs. Pro and Pro AI only.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DevicesSection initialDevices={deviceRows} userId={user.id} />
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Sign out of all devices</p>
                <p className="text-xs text-muted-foreground">
                  This will revoke all active sessions.
                </p>
              </div>
              <SignOutForm>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="w-32 hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
                >
                  Sign out
                </Button>
              </SignOutForm>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
