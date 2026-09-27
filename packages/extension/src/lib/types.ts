import { FREE_TIER_LIMITS, UNLIMITED_TIER_LIMITS } from '@tabmerger/shared';
export interface Tab {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
  ogImage?: string;
  pinned?: boolean;
  chromeGroup?: { id: number; name: string; color: string };
  note?: string;
  savedAt?: number; // epoch ms — set when tab first lands in a saved (non-Now-Open) group
  reminder?: { fireAt: number; note?: string };
  customTitle?: string;
}

export interface Window {
  id: number;
  tabs: Tab[];
  incognito: boolean;
  focused: boolean;
  starred?: boolean;
  name?: string;
  note?: string;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  updatedAt: number;
  windows: Window[];
  permanent?: boolean;
  starred?: boolean; // pinned to top of group list (after Now Open)
  info?: string;
  note?: string;
  pendingSync?: boolean;
  archived?: boolean; // hidden from main sidebar; excluded from free-tier group count
}

export interface UrlRule {
  id: string;       // nanoid(10)
  pattern: string;  // glob-style, e.g. "github.com/*"
  groupId: string;
  createdAt: number;
}

export interface GroupsState {
  active: { id: string; index: number };
  available: Group[];
  urlRules?: UrlRule[];
}

export interface Session {
  id: string;
  name: string;
  description?: string;
  groups: Group[];
  createdAt: number;
}

export type Tier = 'free' | 'pro' | 'pro_ai';

export interface Entitlements {
  tier: Tier;
  maxGroups: number;
  maxTabs: number;
  maxUrlRules: number;
  cloudSync: boolean;
  sessions: boolean;
  aiFeatures: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  subscriptionStatus: string | null;
}

export const TIER_LIMITS: Record<Tier, Entitlements> = {
  free: {
    tier: 'free',
    maxGroups: FREE_TIER_LIMITS.groups,
    maxTabs: FREE_TIER_LIMITS.tabs,
    maxUrlRules: FREE_TIER_LIMITS.urlRules,
    cloudSync: false,
    sessions: false,
    aiFeatures: false,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    subscriptionStatus: null
  },
  pro: {
    tier: 'pro',
    maxGroups: UNLIMITED_TIER_LIMITS.groups,
    maxTabs: UNLIMITED_TIER_LIMITS.tabs,
    maxUrlRules: UNLIMITED_TIER_LIMITS.urlRules,
    cloudSync: true,
    sessions: true,
    aiFeatures: false,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    subscriptionStatus: null
  },
  pro_ai: {
    tier: 'pro_ai',
    maxGroups: UNLIMITED_TIER_LIMITS.groups,
    maxTabs: UNLIMITED_TIER_LIMITS.tabs,
    maxUrlRules: UNLIMITED_TIER_LIMITS.urlRules,
    cloudSync: true,
    sessions: true,
    aiFeatures: true,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    subscriptionStatus: null
  }
};

export const DEFAULT_GROUP_COLOR = 'rgba(128, 128, 128, 1)';
export const FIRST_GROUP_TITLE = 'Now Open';
export const DEFAULT_GROUP_TITLE = 'temp group';
export const DEFAULT_WINDOW_TITLE = 'temp window';

export const PRESET_COLORS = [
  'rgba(239, 68, 68, 1)',
  'rgba(249, 115, 22, 1)',
  'rgba(234, 179, 8, 1)',
  'rgba(34, 197, 94, 1)',
  'rgba(20, 184, 166, 1)',
  'rgba(59, 130, 246, 1)',
  'rgba(99, 102, 241, 1)',
  'rgba(168, 85, 247, 1)',
  'rgba(236, 72, 153, 1)',
  'rgba(128, 128, 128, 1)',
  'rgba(71, 85, 105, 1)',
  'rgba(15, 23, 42, 1)'
];
