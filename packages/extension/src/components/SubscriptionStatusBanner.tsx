import { AlertTriangle } from 'lucide-react';
import { useEntitlements } from '@/hooks/useEntitlements';

const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL as string;

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(iso));
}

export function SubscriptionStatusBanner() {
  const { cancelAtPeriodEnd, currentPeriodEnd, subscriptionStatus, loading } = useEntitlements();

  if (loading) return null;

  if (subscriptionStatus === 'past_due') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-700 text-xs dark:bg-red-950 dark:text-red-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <button
          className="underline underline-offset-2 hover:no-underline"
          onClick={() => chrome.tabs.create({ url: `${WEB_APP_URL}/account` })}
        >
          Payment issue — update your card
        </button>
      </div>
    );
  }

  if (cancelAtPeriodEnd && currentPeriodEnd) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 text-amber-700 text-xs dark:bg-amber-950 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>Your Pro plan ends on {formatDate(currentPeriodEnd)}</span>
      </div>
    );
  }

  return null;
}
