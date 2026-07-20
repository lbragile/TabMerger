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
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { absoluteUrl, formatDate } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Account',
}

export default async function AccountPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

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
        </CardContent>
      </Card>

      {/* Subscription */}
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          <CardDescription>Manage your plan and billing.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Current plan</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={isPaid ? 'default' : 'secondary'}>
                  {currentTier === 'pro_ai'
                    ? 'Pro AI'
                    : currentTier === 'pro'
                      ? 'Pro'
                      : 'Free'}
                </Badge>
                {subscription?.status && subscription.status !== 'active' && (
                  <Badge variant="destructive">{subscription.status}</Badge>
                )}
              </div>
            </div>
            {isPaid && billingPortalUrl ? (
              <Button variant="outline" size="sm" asChild>
                <a href={billingPortalUrl}>Manage billing</a>
              </Button>
            ) : !isPaid ? (
              <Button size="sm" asChild>
                <Link href="/pricing">Upgrade</Link>
              </Button>
            ) : null}
          </div>

          {isPaid && billingPortalUrl && (
            <p className="text-xs text-muted-foreground">
              You can cancel anytime via <strong>Manage billing</strong>. You keep access until the end of your current billing period.
            </p>
          )}

          {subscription?.current_period_end && isPaid && (
            <>
              <Separator />
              <div>
                <p className="text-sm font-medium">Next billing date</p>
                <p className="text-sm text-muted-foreground">
                  {formatDate(subscription.current_period_end)}
                </p>
              </div>
            </>
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
