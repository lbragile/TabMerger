export interface Tab {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
  pinned?: boolean;
  chromeGroup?: { id: number; name: string; color: string };
}

export interface Window {
  id: number;
  tabs: Tab[];
  incognito: boolean;
  focused: boolean;
  starred?: boolean;
  name?: string;
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
  pendingSync?: boolean;
}

export interface GroupsState {
  active: { id: string; index: number };
  available: Group[];
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
  cloudSync: boolean;
  sessions: boolean;
  aiFeatures: boolean;
}

export const TIER_LIMITS: Record<Tier, Entitlements> = {
  free: {
    tier: 'free',
    maxGroups: 5,
    maxTabs: 50,
    cloudSync: false,
    sessions: false,
    aiFeatures: false
  },
  pro: {
    tier: 'pro',
    maxGroups: Infinity,
    maxTabs: Infinity,
    cloudSync: true,
    sessions: true,
    aiFeatures: false
  },
  pro_ai: {
    tier: 'pro_ai',
    maxGroups: Infinity,
    maxTabs: Infinity,
    cloudSync: true,
    sessions: true,
    aiFeatures: true
  }
};

export const DEFAULT_GROUP_COLOR = 'rgba(128, 128, 128, 1)';
export const FIRST_GROUP_TITLE = 'Now Open';
export const DEFAULT_GROUP_TITLE = 'New';
export const DEFAULT_WINDOW_TITLE = 'Window';

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
