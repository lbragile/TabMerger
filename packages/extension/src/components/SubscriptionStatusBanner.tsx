import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDate as formatLocaleDate } from '@/lib/i18n';
import { useEntitlements } from '@/hooks/useEntitlements';

const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL as string;

/**
 * The web app's account page: where a card is updated (past due) and where a cancelled plan is
 * resumed ("Keep my plan") or otherwise managed. Both banners link here.
 */
const ACCOUNT_URL = `${WEB_APP_URL}/account`;

function openAccountPage() {
  void chrome.tabs.create({ url: ACCOUNT_URL });
}

function formatDate(iso: string): string {
  return formatLocaleDate(iso, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function SubscriptionStatusBanner() {
  const { t } = useTranslation();
  const { cancelAtPeriodEnd, currentPeriodEnd, subscriptionStatus, loading } = useEntitlements();

  if (loading) return null;

  if (subscriptionStatus === 'past_due') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-700 text-xs dark:bg-red-950 dark:text-red-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <button
          type="button"
          className="underline underline-offset-2 hover:no-underline"
          onClick={openAccountPage}
        >
          {t('banners.paymentIssue')}
        </button>
      </div>
    );
  }

  if (cancelAtPeriodEnd && currentPeriodEnd) {
    const message = t('banners.planEnds', { date: formatDate(currentPeriodEnd) });
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 text-amber-700 text-xs dark:bg-amber-950 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {/* min-w-0 + truncate keep the bar one line in long locales instead of widening the popup. */}
        <span className="min-w-0 truncate" title={message}>
          {message}
        </span>
        <button
          type="button"
          className="ms-auto shrink-0 whitespace-nowrap rounded-sm font-medium text-amber-800 underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-1 focus-visible:ring-offset-amber-50 dark:text-amber-200 dark:focus-visible:ring-amber-400 dark:focus-visible:ring-offset-amber-950"
          onClick={openAccountPage}
        >
          {t('banners.manageSubscription')}
        </button>
      </div>
    );
  }

  return null;
}
