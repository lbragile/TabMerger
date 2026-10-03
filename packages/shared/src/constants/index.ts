import type { PricingTier } from '../types/index.ts';

export const DEFAULT_GROUP_COLOR = 'rgba(128, 128, 128, 1)';
export const FIRST_GROUP_TITLE = 'Now Open';
export const DEFAULT_GROUP_TITLE = 'New';
export const DEFAULT_WINDOW_TITLE = 'Window';

/** What the Free plan allows. The single source for enforcement, pricing copy and upgrade prompts. */
export const FREE_TIER_LIMITS = { groups: 5, tabs: 50, urlRules: 3, sessions: 3 } as const;

/** Paid plans have no caps. */
export const UNLIMITED_TIER_LIMITS = { groups: Infinity, tabs: Infinity, urlRules: Infinity, sessions: Infinity } as const;

export const AI_COMING_SOON_LABEL = 'Coming soon';

/**
 * Stripe subscription statuses that count as "paid" (grant Pro/Pro AI entitlements).
 * Deliberately narrower than "anything but canceled": `incomplete` (first payment
 * failed), `incomplete_expired`, `unpaid`, and `paused` do NOT entitle. `past_due` is
 * included as Stripe's dunning/retry grace period. Single source of truth shared by
 * the extension's useEntitlements resolveTier() and supabase/migrations/019_gate_cloud_sync_rls.sql's
 * has_cloud_sync() — keep both in sync with this list (see the drift test in
 * packages/extension for the SQL side).
 */
export const ENTITLED_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'] as const;

export type EntitledSubscriptionStatus = (typeof ENTITLED_SUBSCRIPTION_STATUSES)[number];

/** Whether a raw Stripe subscription status counts as paid. See `ENTITLED_SUBSCRIPTION_STATUSES`. */
export function isEntitledSubscriptionStatus(status: string | null | undefined): boolean {
  return !!status && (ENTITLED_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

export const PRESET_COLORS = [
  'rgba(239, 68, 68, 1)',   // red
  'rgba(249, 115, 22, 1)',  // orange
  'rgba(234, 179, 8, 1)',   // yellow
  'rgba(34, 197, 94, 1)',   // green
  'rgba(6, 182, 212, 1)',   // cyan
  'rgba(59, 130, 246, 1)',  // blue
  'rgba(99, 102, 241, 1)',  // indigo
  'rgba(168, 85, 247, 1)',  // purple
  'rgba(236, 72, 153, 1)',  // pink
  'rgba(20, 184, 166, 1)',  // teal
  'rgba(107, 114, 128, 1)', // gray
  'rgba(15, 23, 42, 1)',    // slate dark
] as const;

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'free',
    name: 'Free',
    monthlyPrice: 0,
    yearlyPrice: 0,
    features: [
      `Up to ${FREE_TIER_LIMITS.groups} groups`,
      `Up to ${FREE_TIER_LIMITS.tabs} tabs`,
      `Up to ${FREE_TIER_LIMITS.urlRules} URL rules`,
      `Save up to ${FREE_TIER_LIMITS.sessions} sessions in this browser`,
      'Local storage only',
      'Import & export',
      'Drag & drop',
    ],
    limits: FREE_TIER_LIMITS,
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: 3.99,
    yearlyPrice: 42.99,
    features: [
      'Everything in Free',
      'Unlimited groups, tabs, URL rules & sessions',
      'Cloud sync across devices',
      'Sessions synced across devices',
      'Keyboard shortcuts',
      'Priority support',
    ],
    limits: UNLIMITED_TIER_LIMITS,
    highlighted: true,
  },
  {
    id: 'pro_ai',
    name: 'Pro AI',
    monthlyPrice: 7.99,
    yearlyPrice: 85.99,
    features: [
      'Everything in Pro',
      'AI auto-grouping of tabs',
      'AI group name suggestions',
      'Smart session suggestions',
      'Tab preview with AI summary',
    ],
    limits: UNLIMITED_TIER_LIMITS,
  },
];

/** Looks up a plan by id. Throws on an unknown id so a typo can't silently render nothing. */
export function getPricingTier(id: PricingTier['id']): PricingTier {
  const tier = PRICING_TIERS.find((t) => t.id === id);
  if (!tier) throw new Error(`Unknown pricing tier: ${id}`);
  return tier;
}

export * from './extensionMessages';
export * from './priceFormat';
export * from './firefoxBeta';
export * from './firefoxDataConsent';

/** Appended to a group's name when a sync conflict saves this device's edit as a separate copy. */
export const CONFLICT_COPY_SUFFIX = ' (conflict copy)';
