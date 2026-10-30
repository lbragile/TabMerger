import { useTranslations } from 'next-intl'
import { YEARLY_DISCOUNT_PERCENT, type yearlySavings } from '@/lib/tiers'
import { useListPrice } from './priceFormat'

/**
 * "$3.58/mo billed yearly · save 10%": the yearly plan's monthly equivalent, under its price.
 * Shared by the pricing page's cards and the landing page's teaser so both say the same thing.
 * The saving is the advertised `YEARLY_DISCOUNT_PERCENT`, the same figure as the toggle's badge;
 * a plan with no yearly saving gets the line without it.
 */
export function useYearlySubtext(): (savings: ReturnType<typeof yearlySavings>) => string {
  const t = useTranslations('pricing')
  const listPrice = useListPrice()
  return ({ perMonth, percent }) =>
    percent > 0 && YEARLY_DISCOUNT_PERCENT > 0
      ? t('yearlySubtextWithSaving', { perMonth: listPrice(perMonth), percent: YEARLY_DISCOUNT_PERCENT })
      : t('yearlySubtext', { perMonth: listPrice(perMonth) })
}
