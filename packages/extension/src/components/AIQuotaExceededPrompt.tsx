import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '@/stores/uiStore';
import { openBuyCredits } from '@/lib/buyCredits';

/**
 * Shown in place of a generic error when an AI mutation's `isQuotaExceeded`
 * flag is set (see withQuotaFlag in useAI.ts). Offers the two ways out: a cheaper
 * model (Settings → AI, where each model shows its credits per use) or more credits.
 * The extension doesn't run Stripe Checkout itself — "Get more" deep-links to the
 * web app's account page at its credits section (`openBuyCredits`, shared with
 * Settings → AI), which has the full buy-more-credits flow (quantity slider,
 * checkout, error handling) built once and shared by every surface that can hit this
 * quota (popup header, tab-preview summary, background suggestion banner). Only
 * managed plans see this: own-key (BYOK) plans have no TabMerger credits.
 */
export function AIQuotaExceededPrompt() {
  const { t } = useTranslation();
  const openModal = useUIStore((s) => s.openModal);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 text-xs">
      <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" />
      <p className="min-w-0 flex-1 text-purple-700 dark:text-purple-300">
        {t('banners.aiQuotaPrompt')}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="text-primary hover:underline font-medium"
          onClick={() => openModal('settings', { tab: 'ai' })}
        >
          {t('banners.changeModel')}
        </button>
        <button
          type="button"
          className="text-primary hover:underline font-medium"
          onClick={openBuyCredits}
        >
          {t('banners.getMore')}
        </button>
      </div>
    </div>
  );
}
