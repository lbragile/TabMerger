'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { TierBadge, TierFeatureIcon } from '@/components/pricing/TierBadge'
import { Link } from '@/i18n/navigation'
import {
  TIERS,
  YEARLY_DISCOUNT_PERCENT,
  YEARLY_SAVINGS,
} from '@/lib/tiers'
import { useYearlySubtext } from '@/components/pricing/useYearlySubtext'
import { useListPrice, useZeroPrice } from '@/components/pricing/priceFormat'
import { cn } from '@/lib/utils'
import { PRO_AI_MONTHLY_CREDITS, type AiMode } from '@tabmerger/shared'
import { AiOptionSwitch } from '@/components/pricing/AiOptionSwitch'
import { initialAiMode, isAiOptionAvailable } from '@/components/pricing/aiOptions'

const tiers = [
  { key: 'free', highlighted: false, blurb: 'blurbFree' },
  { key: 'pro', highlighted: true, blurb: 'blurbPro' },
  { key: 'proAi', highlighted: false, blurb: 'blurbProAi' },
] as const

/** The small muted line under a card's price. */
const SUB_LINE = 'text-xs text-text3 mt-1'

export function PricingTeaser() {
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly')
  // Pro AI's option on show: TabMerger's AI or your own key (opens on one that can be bought).
  const [aiMode, setAiMode] = useState<AiMode>(() => initialAiMode())
  const t = useTranslations('home.pricing')
  const p = useTranslations('pricing')
  const common = useTranslations('common')
  const yearlySubtext = useYearlySubtext()
  const listPrice = useListPrice()
  const zeroPrice = useZeroPrice()

  return (
    <section className="py-16 sm:py-[4.5rem] px-6 sm:px-11 border-b border-border">
      <div className="container max-w-[60rem] text-center">
        <h2 className="font-semibold tracking-tight mb-6 text-[1.75rem] sm:text-[2.125rem] leading-tight">
          {t('title')}
        </h2>

        {/* Monthly/Yearly toggle — mirrors the full pricing page's pill toggle */}
        <div className="inline-flex rounded-lg p-[0.1875rem] bg-surface3 border border-border text-sm mb-10">
          {(['monthly', 'yearly'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setInterval(opt)}
              className={cn(
                'h-[1.875rem] px-4 rounded-lg font-medium transition-colors text-[0.8125rem] flex items-center gap-1.5',
                interval === opt
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {opt === 'monthly' ? p('monthly') : p('yearly')}
              {opt === 'yearly' && YEARLY_DISCOUNT_PERCENT > 0 && (
                // Left-to-right isolate: keeps the minus sign before the number in RTL pages.
                <span dir="ltr" className="text-[0.6875rem] font-semibold text-primary">{p('discountBadge', { percent: YEARLY_DISCOUNT_PERCENT })}</span>
              )}
            </button>
          ))}
        </div>

        {/* Stacked on phones, each card is as tall as its own content. Side by side, each card is a
            subgrid over the same three rows (header, blurb, highlights and Pro AI's setup option), so names,
            prices, blurbs and lists line up across cards even when a translation wraps. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 sm:grid-rows-[repeat(3,auto)] gap-x-4 gap-y-8 sm:gap-y-0 mb-8 pt-3 text-start">
          {tiers.map((row) => {
            const tier = TIERS[row.key]
            const isProAi = row.key === 'proAi'
            const isOwnKey = isProAi && aiMode === 'byok'
            const prices = isOwnKey ? TIERS.proAi.byok : tier
            const isComingSoon = isProAi && !isAiOptionAvailable(aiMode)
            const rawPrice = interval === 'monthly' ? prices.monthlyPrice : prices.yearlyPrice
            const price = rawPrice === 0 ? zeroPrice : listPrice(rawPrice)
            const period = rawPrice === 0 ? p('forever') : interval === 'monthly' ? p('perMonth') : p('perYear')
            // Same wording and numbers as the pricing page's yearly cards.
            const monthlyEquivalent =
              row.key === 'free' ? null : yearlySubtext(isOwnKey ? YEARLY_SAVINGS.proAiByok : YEARLY_SAVINGS[row.key])
            // Three short highlights per card, worded by the pricing page's own feature labels.
            // `inherited` ("Everything in …") gets a check and the rest a +, as on /pricing.
            const added = (text: string) => ({ text, inherited: false })
            const inheritedLine = (text: string) => ({ text, inherited: true })
            const highlights =
              row.key === 'free'
                ? [
                    added(p('features.upToGroups', { count: TIERS.free.limits.groups })),
                    added(p('features.upToTabs', { count: TIERS.free.limits.tabs })),
                    added(p('features.importExport')),
                    added(p('features.dragDrop')),
                  ]
                : row.key === 'pro'
                  ? [
                      inheritedLine(p('features.everythingInFree')),
                      added(p('features.unlimited')),
                      added(p('features.cloudSync')),
                      added(p('features.sessionsSynced')),
                    ]
                  : [
                      inheritedLine(p('features.everythingInPro')),
                      added(p('features.aiGrouping')),
                      added(
                        isOwnKey
                          ? p('features.ownApiKey')
                          : p('features.aiCreditsMonthly', { count: PRO_AI_MONTHLY_CREDITS })
                      ),
                    ]
            const badge = row.highlighted ? p('recommended') : isComingSoon ? common('comingSoon') : null
            return (
              <div
                key={row.key}
                data-tier={row.key}
                className={cn(
                  'relative min-w-0 flex flex-col sm:grid sm:grid-rows-subgrid sm:row-span-3 rounded-2xl border p-6',
                  row.highlighted
                    ? 'border-primary ring-1 ring-primary bg-gradient-to-b from-primary/10 to-surface shadow-sh3'
                    : 'border-border bg-surface'
                )}
              >
                {badge && <TierBadge tone={row.highlighted ? 'solid' : 'muted'}>{badge}</TierBadge>}
                <div>
                  <p className="text-sm font-semibold">{tier.name}</p>
                  <p className="mt-2 text-4xl font-semibold tracking-tight">
                    {price}
                    <span className="text-[0.8125rem] font-normal text-text3 ms-1">{period}</span>
                  </p>
                  {/* Every card has a note line. A paid card's is the yearly price per month: on
                      Monthly it stays in place, hidden from sight and from assistive tech, so its
                      space is already reserved and nothing moves on toggling. */}
                  {monthlyEquivalent === null ? (
                    <p className={SUB_LINE}>{p('noCard')}</p>
                  ) : (
                    <p
                      className={cn(SUB_LINE, interval === 'monthly' && 'invisible')}
                      aria-hidden={interval === 'monthly' ? true : undefined}
                    >
                      {monthlyEquivalent}
                    </p>
                  )}
                </div>
                <p className="mt-4 text-sm text-muted-foreground">{t(row.blurb)}</p>
                {/* Pro AI's setup choice closes this row, below the highlights, so it never shifts a price. */}
                <div className="mt-4 flex flex-col border-t border-border pt-4">
                  <ul className="space-y-2 text-sm">
                    {highlights.map(({ text, inherited }) => (
                      <li key={text} className="flex items-start gap-2">
                        <TierFeatureIcon inherited={inherited} />
                        <span className="min-w-0">{text}</span>
                      </li>
                    ))}
                  </ul>
                  {isProAi && (
                    <div className="mt-auto pt-4">
                      <AiOptionSwitch value={aiMode} onChange={setAiMode} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <Link
          href="/pricing"
          className="inline-flex items-center gap-1.5 h-11 px-6 rounded-lg bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:bg-primary/90 transition-colors mb-4"
        >
          {t('seeFull')}
          {/* Points forward: mirrored right to left. */}
          <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
        </Link>

        <p className="text-[0.78125rem] text-text3">
          {t('cancelNote')}
        </p>
        <p className="text-xs text-text3 mt-1">{p('usdNote')}</p>
      </div>
    </section>
  )
}
