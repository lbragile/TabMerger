import { Check, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TierBadgeProps {
  /** Already translated ("Recommended", "Current", "Coming soon"). */
  children: React.ReactNode
  /** `solid`: Recommended (brand color). `neutral`: Current, a status rather than a pitch.
   *  `muted`: Coming soon. */
  tone?: 'solid' | 'neutral' | 'muted'
}

/**
 * A plan card's status pill, centered on the card's top border so it never moves the plan name.
 * The card must be `relative`. Shared by the home teaser and the pricing cards; a card shows one
 * at a time (Current wins over Recommended, which a current plan never shows).
 */
export function TierBadge({ children, tone = 'solid' }: TierBadgeProps) {
  return (
    <span
      className={cn(
        // Centered with inset-x + mx-auto (symmetric, so it needs no right-to-left variant).
        'absolute inset-x-0 mx-auto w-fit top-0 -translate-y-1/2 whitespace-nowrap rounded-none px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider leading-none',
        tone === 'solid' && 'bg-primary text-primary-foreground',
        tone === 'neutral' && 'bg-foreground text-background',
        tone === 'muted' && 'bg-muted text-muted-foreground border border-border'
      )}
    >
      {children}
    </span>
  )
}

/**
 * A feature line's icon: a check for "Everything in …" (already-included capabilities), a + for
 * what the plan adds. Free has no "Everything in" line, so all its lines get a +.
 */
export function TierFeatureIcon({ inherited }: { inherited?: boolean }) {
  const Icon = inherited ? Check : Plus
  // One line tall, so in an items-start row the icon centers on the first line of a wrapped label.
  return (
    <span className="flex h-[1lh] shrink-0 items-center">
      <Icon aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
    </span>
  )
}
