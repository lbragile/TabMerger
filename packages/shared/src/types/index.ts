// Core extension types

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
}

export interface ExtWindow {
  id: number;
  tabs: Tab[];
  incognito: boolean;
  focused: boolean;
  starred?: boolean;
  name?: string;
  note?: string;
}

export interface Group {
  id: string; // nanoid(10)
  name: string;
  color: string; // rgba string
  updatedAt: number; // epoch ms
  windows: ExtWindow[];
  permanent?: boolean; // first group only
  starred?: boolean; // pinned to top of group list (after Now Open)
  info?: string;
  note?: string;
  pendingSync?: boolean; // local-only, not persisted to Supabase
  archived?: boolean; // hidden from main sidebar; excluded from free-tier group count
}

export interface UrlRule {
  id: string;
  pattern: string;
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

// Subscription tiers
export type SubscriptionTier = 'free' | 'pro' | 'pro_ai';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete';

export interface Subscription {
  id: string; // Stripe subscription ID
  userId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodEnd: string; // ISO datetime
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  id: string; // Supabase auth.users UUID
  email: string;
  stripeCustomerId?: string;
  createdAt: string;
}

// Supabase DB row types (snake_case matching DB columns)
export interface SupabaseGroup {
  id: string;
  user_id: string;
  name: string;
  color: string;
  position: number;
  windows: ExtWindow[]; // stored as jsonb
  info?: string;
  updated_at: string;
  created_at: string;
}

export interface SupabaseSession {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  groups: Group[]; // stored as jsonb
  created_at: string;
}

// AI API request/response types
export interface AIGroupTabsRequest {
  tabs: Pick<Tab, 'id' | 'title' | 'url'>[];
}

export interface AIGroupTabsResponse {
  groups: {
    name: string;
    color: string;
    tabIds: number[];
  }[];
}

export interface AINameGroupRequest {
  tabs: Pick<Tab, 'title' | 'url'>[];
}

export interface AINameGroupResponse {
  name: string;
}

export interface AITabSummaryRequest {
  url: string;
  title: string;
}

export interface AITabSummaryResponse {
  summary: string;
}

export interface AISuggestSessionsRequest {
  recentGroups: Group[];
}

export interface AISuggestSessionsResponse {
  suggestion: string;
}

// Pricing
export interface PricingTier {
  id: SubscriptionTier;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  limits: { groups: number; tabs: number };
  highlighted?: boolean;
}
