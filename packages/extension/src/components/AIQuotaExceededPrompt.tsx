import { Sparkles } from 'lucide-react';

const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL as string;

/**
 * Shown in place of a generic error when an AI mutation's `isQuotaExceeded`
 * flag is set (see withQuotaFlag in useAI.ts). The extension doesn't run
 * Stripe Checkout itself — it deep-links to the web app's account page,
 * which has the full buy-more-credits flow (quantity slider, checkout,
 * error handling) built once and shared by every surface that can hit this
 * quota (popup header, tab-preview summary, background suggestion banner).
 */
export function AIQuotaExceededPrompt() {
  const handleBuyCredits = () => {
    chrome.tabs.create({ url: `${WEB_APP_URL}/account`, active: true });
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 text-xs">
      <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" />
      <p className="flex-1 text-purple-700 dark:text-purple-300">
        You&apos;ve used all your AI calls for this month.
      </p>
      <button
        type="button"
        className="text-primary hover:underline shrink-0 font-medium"
        onClick={handleBuyCredits}
      >
        Get more
      </button>
    </div>
  );
}
