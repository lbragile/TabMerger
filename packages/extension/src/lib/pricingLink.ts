import { trackEvent } from '@/lib/analytics';

/** Opens the web app's pricing page in a new focused tab, counting the click (`upgrade_clicked`, by `source`). */
export function openPricingPage(source: string): void {
  trackEvent('upgrade_clicked', { source });
  void chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing`, active: true });
}
