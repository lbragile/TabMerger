'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { AiMode } from '@tabmerger/shared'
import { PricingCard } from './PricingCard'
import { TIERS, YEARLY_DISCOUNT_PERCENT, YEARLY_SAVINGS } from '@/lib/tiers'
import { useListPrice, useZeroPrice } from './priceFormat'
import { useTierFeatures, useTierName } from './tierFeatures'
import { useYearlySubtext } from './useYearlySubtext'
import { cn } from '@/lib/utils'

interface PricingTableProps {
  currentTier?: string
  /** How the current paid plan is billed; unknown (or free) leaves it undefined. */
  currentInterval?: 'monthly' | 'yearly'
  /** A Pro AI subscriber's option (TabMerger's AI or their own key). */
  currentAiMode?: AiMode
  /** When the current paid period ends: the date a scheduled plan change takes effect. */
  currentPeriodEnd?: string | null
  /** The Free card's install link, resolved on the server (`getStoreLinks()`) by the page. */
  installHref: string
}

export function PricingTable({ currentTier, currentInterval, currentAiMode, currentPeriodEnd, installHref }: PricingTableProps) {
  // Always opens on Monthly, whatever the current plan is billed at.
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly')
  const t = useTranslations('pricing')
  const tierName = useTierName()
  const tierFeatures = useTierFeatures()
  const listPrice = useListPrice()
  const zeroPrice = useZeroPrice()
  const yearlySubtext = useYearlySubtext()

  return (
    <div className="flex flex-col items-center gap-10">
      {/* Segmented toggle */}
      <div className="inline-flex rounded-md p-[3px] bg-surface3 border border-border text-sm">
        {(['monthly', 'yearly'] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setInterval(opt)}
            className={cn(
              'h-[30px] px-4 rounded-lg font-medium transition-colors text-[13px] flex items-center gap-1.5 cursor-pointer',
              interval === opt
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {opt === 'monthly' ? t('monthly') : t('yearly')}
            {opt === 'yearly' && YEARLY_DISCOUNT_PERCENT > 0 && (
              // A left-to-right isolate: in a right-to-left page the leading minus sign would
              // otherwise land after the number ("10%−").
              <span dir="ltr" className="text-[11px] font-semibold text-primary">{t('discountBadge', { percent: YEARLY_DISCOUNT_PERCENT })}</span>
            )}
          </button>
        ))}
      </div>

      {/* Grid: 1fr 1.1fr 1fr */}
      <div
        className="w-full max-w-5xl grid grid-cols-1 md:[grid-template-columns:1fr_1.1fr_1fr] gap-4 items-center"
      >
        <PricingCard
          tier="free"
          name={tierName('free')}
          monthlyPrice={TIERS.free.monthlyPrice}
          yearlyPrice={TIERS.free.yearlyPrice}
          features={tierFeatures('free')}
          interval={interval}
          currentTier={currentTier}
          currentInterval={currentInterval}
          currentPeriodEnd={currentPeriodEnd}
          installHref={installHref}
          displayMonthly={zeroPrice}
          displayYearly={zeroPrice}
        />

        {/* Pro — highlighted, same order as desktop */}
        <div>
          <PricingCard
            tier="pro"
            name={tierName('pro')}
            monthlyPrice={TIERS.pro.monthlyPrice}
            yearlyPrice={TIERS.pro.yearlyPrice}
            features={tierFeatures('pro')}
            interval={interval}
            highlighted
            currentTier={currentTier}
            currentInterval={currentInterval}
            currentPeriodEnd={currentPeriodEnd}
            installHref={installHref}
            displayMonthly={listPrice(TIERS.pro.monthlyPrice)}
            displayYearly={listPrice(TIERS.pro.yearlyPrice)}
            yearlySubtext={yearlySubtext(YEARLY_SAVINGS.pro)}
          />
        </div>

        {/* Pro AI: both options, TabMerger's AI and your own key, behind a switch on the card. */}
        <PricingCard
          tier="proAi"
          name={tierName('proAi')}
          monthlyPrice={TIERS.proAi.monthlyPrice}
          yearlyPrice={TIERS.proAi.yearlyPrice}
          features={tierFeatures('proAi')}
          interval={interval}
          currentTier={currentTier}
          currentInterval={currentInterval}
          currentPeriodEnd={currentPeriodEnd}
          currentAiMode={currentAiMode}
          installHref={installHref}
          aiOptions={{
            managed: {
              monthlyPrice: TIERS.proAi.monthlyPrice,
              yearlyPrice: TIERS.proAi.yearlyPrice,
              displayMonthly: listPrice(TIERS.proAi.monthlyPrice),
              displayYearly: listPrice(TIERS.proAi.yearlyPrice),
              yearlySubtext: yearlySubtext(YEARLY_SAVINGS.proAi),
              features: tierFeatures('proAi', 'managed'),
            },
            byok: {
              monthlyPrice: TIERS.proAi.byok.monthlyPrice,
              yearlyPrice: TIERS.proAi.byok.yearlyPrice,
              displayMonthly: listPrice(TIERS.proAi.byok.monthlyPrice),
              displayYearly: listPrice(TIERS.proAi.byok.yearlyPrice),
              yearlySubtext: yearlySubtext(YEARLY_SAVINGS.proAiByok),
              features: tierFeatures('proAi', 'byok'),
            },
          }}
        />
      </div>

      <p className="text-sm text-muted-foreground text-center">
        {t('cancelAnytime')}
        <br />
        {t('keepAccess')}
      </p>
      <p className="-mt-6 text-xs text-text3 text-center">{t('usdNote')}</p>
    </div>
  )
}
