/**
 * GA4 / PostHog event names shared by the extension and the web app, so both send (and the
 * GA4 reports and docs/ANALYTICS.md read) exactly the same strings. Every name follows GA4's
 * rule: a letter, then letters, digits or underscores, 40 characters at most.
 *
 * Add new cross-package event names here rather than repeating a string literal.
 */
export const ANALYTICS_EVENTS = {
  /** Extension `runtime.onInstalled` with reason `install` (extension → `/api/track`). */
  extensionInstalled: 'extension_installed',
  /** Extension `runtime.onInstalled` with any other reason, e.g. an update. */
  extensionUpdated: 'extension_updated',
  /** Fired by the web app's server when the uninstall page (`/uninstalled`) loads. */
  extensionUninstalled: 'extension_uninstalled',
  /** Once a day from the extension's background worker: "this install is still alive". */
  extensionHeartbeat: 'extension_heartbeat',
  /** Scheduled server-side event (Vercel cron): "the site, the cron and the GA pipeline work". */
  webHeartbeat: 'web_heartbeat',

  // Checkout funnel (web app). GA4's recommended e-commerce names where GA4 has one.
  /** Web client: a checkout CTA was clicked and the checkout session request started (GA4 recommended). */
  beginCheckout: 'begin_checkout',
  /** Web client: Stripe sent the buyer back through the checkout's `cancel_url`. */
  checkoutCanceled: 'checkout_canceled',
  /** Stripe webhook `checkout.session.expired`: a started checkout ran out without payment. */
  checkoutAbandoned: 'checkout_abandoned',
  /** Stripe webhook `checkout.session.completed` for a subscription (GA4 recommended). */
  purchase: 'purchase',
  /** Same moment as `purchase`: the original custom name, still sent so existing reports keep working. */
  checkoutCompleted: 'checkout_completed',
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
