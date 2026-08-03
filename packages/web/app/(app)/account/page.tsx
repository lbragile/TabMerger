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
  const isPaid = currentTier !== 'free' && subscription?.status === 'active'

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

      {/* Usage summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-1">
        {[
          { label: 'Groups synced', value: '24' },
          { label: 'Tabs saved', value: '847' },
          { label: 'Sessions', value: '12' },
          { label: 'AI calls left', value: currentTier === 'pro_ai' ? '47' : '0', accent: currentTier === 'pro_ai' },
        ].map((stat, i) => (
          <div
            key={i}
            className={`rounded-[13px] border p-4 ${stat.accent ? 'bg-accent border-primary/20' : 'bg-surface border-border'}`}
          >
            <p className={`font-semibold tracking-tight ${stat.accent ? 'text-primary' : ''}`} style={{ fontSize: '26px' }}>
              {stat.value}
            </p>
            <p className="text-[12px] text-text2 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

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
                <Button variant="outline" size="sm" asChild>
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

      {/* Session management */}
      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>
            Manage your active sessions across devices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Sign out of all devices</p>
              <p className="text-xs text-muted-foreground">
                This will revoke all active sessions.
              </p>
            </div>
            <form action="/api/auth/sign-out" method="POST">
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
