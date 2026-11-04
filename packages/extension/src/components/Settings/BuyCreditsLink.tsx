import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@/components/ui/button';
import { buyCreditsUrl, isLowCreditBalance } from '@/lib/buyCredits';
import { cn } from '@/lib/utils';
import { openInNewTab } from '@/lib/websiteLink';

interface BuyCreditsLinkProps {
  /** Credits left this month. */
  remaining: number;
  /** This month's total: the allowance plus credit packs bought this month. */
  total: number;
  /** Whether the numbers have been read; an unknown balance is never shown as low. */
  known: boolean;
}

/**
 * Settings → AI "Buy more credits" for managed Pro AI: opens the web app's account page at its
 * credits section in a new tab. A plain link normally; a small button once the balance is low
 * (below `LOW_CREDIT_BALANCE_RATIO` of the month's total). The accessible name says it opens a
 * new tab, the way the header's website link does.
 */
export function BuyCreditsLink({ remaining, total, known }: BuyCreditsLinkProps) {
  const { t } = useTranslation();
  const url = buyCreditsUrl();
  const low = known && isLowCreditBalance(remaining, total);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('settings.ai.buyCreditsLabel')}
      data-testid="ai-buy-credits"
      data-emphasis={low ? 'low' : 'normal'}
      className={cn(
        'shrink-0 text-xs',
        low
          ? cn(buttonVariants({ size: 'sm' }), 'h-7 px-2')
          : 'font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
      )}
      onClick={(e) => openInNewTab(e, url)}
    >
      {t('settings.ai.buyCredits')}
    </a>
  );
}
