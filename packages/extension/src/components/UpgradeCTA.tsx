import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Zap } from 'lucide-react';
import { isTourDemoGroup } from '@tabmerger/shared';
import { useGroups } from '@/hooks/useGroups';
import { useEntitlements, isApproachingLimit } from '@/hooks/useEntitlements';
import { trackEvent } from '@/lib/analytics';

const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL as string;
const DISMISSED_KEY = 'upgrade_cta_dismissed';

export function UpgradeCTA() {
  const { t } = useTranslation();
  // ponytail: sessionStorage, not localStorage — nag banner reappears next
  // browser session rather than being permanently dismissed.
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISSED_KEY) === '1'
  );
  const { data: groupsState } = useGroups();
  const { tier, maxGroups, maxTabs, subscriptionStatus, loading } = useEntitlements();
  const trackedRef = useRef(false);

  const eligible = !loading && !dismissed && tier === 'free' && subscriptionStatus === null && !!groupsState;
  // exclude Now Open (index 0) only — archived groups still count toward the limit
  // (nor the guided tour's practice groups, which are not the user's)
  const saved = eligible ? groupsState!.available.slice(1).filter((g) => !isTourDemoGroup(g)) : [];
  const groupCount = saved.length;
  const totalTabs = saved.reduce((sum, g) => sum + g.windows.reduce((ws, w) => ws + w.tabs.length, 0), 0);
  const shown = eligible && isApproachingLimit(groupCount, totalTabs, maxGroups, maxTabs);

  if (shown && !trackedRef.current) {
    trackedRef.current = true;
    trackEvent('upgrade_prompt_shown', { source: 'nag_banner' });
  }

  if (!shown) return null;

  function dismiss() {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-700 text-xs dark:bg-indigo-950 dark:text-indigo-300">
      <Zap className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">
        {t('banners.approachingLimit')}
      </span>
      <button
        className="font-semibold underline underline-offset-2 hover:no-underline shrink-0"
        onClick={() => {
          trackEvent('upgrade_clicked', { source: 'nag_banner' });
          chrome.tabs.create({ url: `${WEB_APP_URL}/pricing` });
        }}
      >
        {t('banners.upgrade')}
      </button>
      <button
        className="ms-1 hover:opacity-70 shrink-0"
        onClick={dismiss}
        aria-label={t('banners.dismiss')}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
