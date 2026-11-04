/**
 * Where a managed Pro AI user buys more AI credits, and when to push them toward it.
 *
 * The extension doesn't run Stripe Checkout itself: buying deep-links to the web app's account
 * page, whose credits section starts checkout (`/api/checkout/credits`). The server decides who
 * may buy; these helpers only send the user there.
 */
import { ACCOUNT_AI_CREDITS_ANCHOR } from '@tabmerger/shared';

/**
 * Below this share of the month's total credits (allowance plus packs bought this month) the
 * Settings → AI "Buy more credits" control is shown as a button instead of a link.
 */
export const LOW_CREDIT_BALANCE_RATIO = 0.1;

/** The web app's account page, opened at its AI credits section (the buy control), for `webAppUrl` (the build's `VITE_WEB_APP_URL`). */
export function buyCreditsUrl(webAppUrl: string | undefined = import.meta.env.VITE_WEB_APP_URL): string {
  return `${webAppUrl ?? ''}/account#${ACCOUNT_AI_CREDITS_ANCHOR}`;
}

/** Opens {@link buyCreditsUrl} in a new active tab. */
export function openBuyCredits(): void {
  void chrome.tabs.create({ url: buyCreditsUrl(), active: true });
}

/**
 * Whether `remaining` credits are below {@link LOW_CREDIT_BALANCE_RATIO} of this month's `total`.
 * A total of 0 (or anything not a positive number) is low only when nothing is left, so an empty
 * allowance still counts and nothing divides by zero.
 */
export function isLowCreditBalance(remaining: number, total: number): boolean {
  if (!Number.isFinite(remaining)) return false;
  if (!(total > 0) || !Number.isFinite(total)) return remaining <= 0;
  return remaining / total < LOW_CREDIT_BALANCE_RATIO;
}
