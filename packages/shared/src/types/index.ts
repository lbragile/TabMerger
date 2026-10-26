// Core extension types

import type { AiMode, AiSuggestionKind } from '../constants/ai';

export interface Tab {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
  // Legacy field — was written by a content script that no longer exists. Nothing in the
  // current codebase sets a *new* value here; existing values are only ever carried forward
  // (e.g. useCurrentTabs.ts on Now Open rebuild, useGroups.ts on tab move/duplicate), so it's
  // empty for almost every tab. The opt-in preview-image fetch (og-preview) shows its result
  // in the TabPreview tooltip only — it is never persisted here. See useTabPreview.ts.
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
  /**
   * Practice data made by the extension's guided tour. Local-only and short-lived: never synced,
   * backed up, exported, shared or counted. Test it with `isTourDemoGroup`, never directly.
   */
  tourDemo?: boolean;
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
  /** True for a snapshot the extension took by itself (automatic backup). Travels inside the encrypted blob only. */
  auto?: boolean;
}

// Subscription tiers
export type SubscriptionTier = 'free' | 'pro' | 'pro_ai';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete';

export interface Subscription {
  id: string; // Stripe subscription ID
  userId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  /** Pro AI only: TabMerger's key (`managed`) or the customer's own (`byok`). `subscriptions.ai_mode`. */
  aiMode: AiMode;
  /** Managed AI credits granted each month, worked out from what the plan pays; 0 for BYOK. */
  aiMonthlyCredits: number;
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
  window_count: number; // denormalized plaintext count, maintained by client on every write
  tab_count: number; // denormalized plaintext count, maintained by client on every write
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

/**
 * `POST /api/ai/name-group` answer.
 */
export interface AINameGroupResponse {
  /** 1 to 3 distinct suggestions (case-insensitively, after cleaning), best first. */
  names: string[];
  /** Always `names[0]`. Kept so older extension builds that read only `name` still work. */
  name: string;
}

/**
 * `POST /api/ai/describe-group` body: a saved group's name and tabs, decrypted by the client (the
 * server never reads group content from Supabase, it is end-to-end encrypted).
 */
export interface AIDescribeGroupRequest {
  groupName: string;
  tabs: Pick<Tab, 'title' | 'url'>[];
  /** An `AiModelChoice`; missing or `auto` uses the feature's default model. */
  model?: string;
}

/** `POST /api/ai/describe-group` 200 body: 1-3 plain sentences, at most `AI_MAX_GROUP_DESCRIPTION_LENGTH` characters. */
export interface AIDescribeGroupResponse {
  description: string;
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
  /** Banner text, max ~100 chars. */
  message: string;
  /** `Group.id` values the message refers to — lets the UI offer a per-group action. */
  staleGroupIds: string[];
  /** What the banner offers for those groups. `merge` always comes with at least two ids. */
  kind: AiSuggestionKind;
  /** @deprecated alias for `message`; remove once the extension banner migrates. */
  suggestion: string;
}

/**
 * One change proposed by `POST /api/ai/organize`, applied by the extension after the user
 * reviews it. Ids are `Group.id` values from the request; the server never names a permanent
 * group (Now Open) in merge, rename or delete, and `newName` is cleaned and at most 30 chars.
 */
export type OrganizeAction =
  | { type: 'merge'; sourceGroupId: string; targetGroupId: string }
  | { type: 'rename'; groupId: string; newName: string }
  | { type: 'delete'; groupId: string }
  | { type: 'reorder'; groupIds: string[] };

/** `POST /api/ai/organize` 200 body. No changes needed is `{ actions: [] }`. */
export interface OrganizeResponse {
  actions: OrganizeAction[];
}

// "Continue on other device" — device_sessions table (see supabase/migrations/013_create_device_sessions.sql)
export interface DeviceSession {
  device_id: string;
  device_name: string;
  now_open_snapshot: unknown; // Group['windows'] snapshot, jsonb — kept loose so malformed rows don't throw
  last_active: string; // ISO datetime
}

// Pricing
export interface PricingTier {
  id: SubscriptionTier;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  limits: { groups: number; tabs: number; urlRules: number; sessions: number };
  highlighted?: boolean;
  /** Pro AI only: the bring-your-own-key option, same features with AI billed to the customer's key. */
  byok?: { monthlyPrice: number; yearlyPrice: number; features: string[] };
}
