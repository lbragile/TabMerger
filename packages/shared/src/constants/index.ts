import type { PricingTier } from '../types/index.ts';

export const DEFAULT_GROUP_COLOR = 'rgba(128, 128, 128, 1)';
export const FIRST_GROUP_TITLE = 'Now Open';
export const DEFAULT_GROUP_TITLE = 'New';
export const DEFAULT_WINDOW_TITLE = 'Window';

export const FREE_TIER_LIMITS = { groups: 5, tabs: 50 } as const;

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
      'Up to 5 groups',
      'Up to 50 tabs',
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
      'Unlimited groups & tabs',
      'Cloud sync across devices',
      'Session save & restore',
      'Keyboard shortcuts',
      'Priority support',
    ],
    limits: { groups: Infinity, tabs: Infinity },
    highlighted: true,
  },
  {
    id: 'pro_ai',
    name: 'Pro AI',
    monthlyPrice: 7.99,
    yearlyPrice: 85.99,
    features: [
      'Everything in Pro',
      'AI auto-grouping',
      'AI group name suggestions',
      'Smart session suggestions',
      'Tab preview with AI summary',
    ],
    limits: { groups: Infinity, tabs: Infinity },
  },
];
