import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Zap, Calendar } from 'lucide-react'
import { formatUsd, getPriceInfo } from '@/lib/tiers'

interface SubscriptionBadgeProps {
  tier: 'free' | 'pro' | 'pro_ai'
  status?: string
  currentPeriodEnd?: string
  /** `subscriptions.stripe_price_id` — used to recover the display cost/interval. */
  priceId?: string | null
  /** Overrides the default free-tier "Upgrade" button (e.g. account page's "Manage billing" link). */
  action?: React.ReactNode
}

const tierConfig = {
  free: { label: 'free', variant: 'secondary' as const },
  pro: { label: 'pro', variant: 'default' as const },
  pro_ai: { label: 'proAi', variant: 'secondary' as const },
} satisfies Record<string, { label: 'free' | 'pro' | 'proAi'; variant: 'secondary' | 'default' }>

const KNOWN_STATUSES = ['active', 'canceled', 'past_due', 'trialing', 'incomplete'] as const

export function SubscriptionBadge({
  tier,
  status,
  currentPeriodEnd,
  priceId,
  action,
}: SubscriptionBadgeProps) {
  const config = tierConfig[tier] ?? tierConfig.free
  const t = useTranslations('dashboard.subscription')
  const tierNames = useTranslations('pricing.tierNames')
  const pricing = useTranslations('pricing')
  const locale = useLocale()
  // A status outside the stored list is shown as Stripe wrote it.
  const statusLabel = (KNOWN_STATUSES as readonly string[]).includes(status ?? '')
    ? t(`statuses.${status as (typeof KNOWN_STATUSES)[number]}`)
    : status
  // ponytail: show billing info for any non-canceled paid status (active, trialing, past_due) —
  // a past-due or trialing sub still has a real upcoming charge/renewal date worth surfacing,
  // hiding it only when the subscription is actually gone.
  const isActive = !status || status !== 'canceled'
  const priceInfo = tier !== 'free' ? getPriceInfo(priceId) : null

  return (
    <div className="flex items-center gap-3 border p-4">
      <div className="flex h-10 w-10 items-center justify-center bg-primary/10">
        <Zap className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium">{t('currentPlan')}</p>
          <Badge variant={config.variant} className="rounded-md">{tierNames(config.label)}</Badge>
          {status && status !== 'active' && (
            <Badge variant="destructive" className="rounded-md">{statusLabel}</Badge>
          )}
        </div>
        {isActive && tier !== 'free' && (priceInfo || currentPeriodEnd) && (
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground mt-1">
            {currentPeriodEnd && (
              <>
                <Calendar className="h-3.5 w-3.5 text-primary shrink-0" />
                {t('renews', {
                  date: new Date(currentPeriodEnd).toLocaleDateString(locale, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  }),
                })}
              </>
            )}
            {priceInfo && (
              <span className="text-muted-foreground font-normal">
                {currentPeriodEnd && ' · '}{formatUsd(priceInfo.amount)}
                {priceInfo.interval === 'monthly' ? pricing('perMonth') : pricing('perYear')}
              </span>
            )}
          </p>
        )}
      </div>
      {action ?? (tier === 'free' && (
        <Button size="sm" asChild>
          <Link href="/pricing">{t('upgrade')}</Link>
        </Button>
      ))}
    </div>
  )
}
