import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Zap } from 'lucide-react'

interface SubscriptionBadgeProps {
  tier: 'free' | 'pro' | 'pro_ai'
  status?: string
  currentPeriodEnd?: string
}

const tierConfig = {
  free: { label: 'Free', variant: 'secondary' as const },
  pro: { label: 'Pro', variant: 'default' as const },
  pro_ai: { label: 'Pro AI', variant: 'default' as const },
}

export function SubscriptionBadge({
  tier,
  status,
  currentPeriodEnd,
}: SubscriptionBadgeProps) {
  const config = tierConfig[tier] ?? tierConfig.free
  const isActive = !status || status === 'active'

  return (
    <div className="flex items-center gap-3 rounded-lg border p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
        <Zap className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium">Current plan</p>
          <Badge variant={config.variant}>{config.label}</Badge>
          {status && status !== 'active' && (
            <Badge variant="destructive">{status}</Badge>
          )}
        </div>
        {currentPeriodEnd && isActive && tier !== 'free' && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Renews{' '}
            {new Date(currentPeriodEnd).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        )}
      </div>
      {tier === 'free' && (
        <Button size="sm" asChild>
          <Link href="/pricing">Upgrade</Link>
        </Button>
      )}
    </div>
  )
}
