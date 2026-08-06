import { useMutation } from '@tanstack/react-query';
import { trackEvent } from '@/lib/analytics';
import type { Tab, Group } from '@/lib/types';
import { useAuth } from './useAuth';
import { useEntitlements } from './useEntitlements';
import { useAppSettings } from './useAppSettings';
import { wasCalledToday, markCalledToday } from '@/lib/aiThrottle';

const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL as string;

/** Thrown by {@link aiPost} on a 429 so callers can distinguish "out of AI calls" from any other failure. */
export class QuotaExceededError extends Error {
  isQuotaExceeded = true as const;
}

/**
 * Enforces a once-per-calendar-day client-side throttle for AI actions the extension
 * fires automatically (not from a direct user click), gated by the user's
 * `aiDailyThrottle` setting (on by default). The server quota is monthly, so an
 * automatic trigger re-firing on every popup open can silently burn the whole
 * month's budget in a day (see AIGroupSuggestion's background suggest-sessions
 * fetch). Manual button-driven mutations (useAutoGroup, useNameGroup,
 * useOrganizeTabs) deliberately do NOT use this — a human clicking a button is a
 * self-limiting action and the server's monthly cap is the only backstop needed
 * there. useTabSummary is also excluded (see its own note).
 */
async function enforceDailyThrottle(action: string, throttleEnabled: boolean) {
  if (!throttleEnabled) return;
  if (await wasCalledToday(action)) {
    throw new Error('Already used today — this AI action is limited to once per day');
  }
  await markCalledToday(action);
}

/**
 * Shared cross-origin fetch helper for all AI API routes.
 * Sends a `Bearer` token because the extension runs on a different origin and
 * cannot use session cookies. The web app's API routes verify this JWT server-side.
 */
async function aiPost<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${WEB_APP_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new QuotaExceededError(`AI request failed: ${res.status} ${text}`);
    throw new Error(`AI request failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<T>;
}

/** Derives isQuotaExceeded from a mutation's settled error so components can show a "buy more AI calls" prompt instead of a generic error. */
function withQuotaFlag<T extends { error: unknown }>(mutation: T): T & { isQuotaExceeded: boolean } {
  return { ...mutation, isQuotaExceeded: mutation.error instanceof QuotaExceededError };
}

export function useAutoGroup() {
  const { session } = useAuth();
  const { aiFeatures } = useEntitlements();
  const { data: settings } = useAppSettings();

  return useMutation({
    onSuccess: () => { trackEvent('ai_feature_used', { feature_name: 'group' }); trackEvent('ai_auto_group_used'); },
    // ponytail: no daily throttle — this is a manual button click, always run it
    // (subject to the existing server-side monthly quota only).
    mutationFn: async (tabs: Tab[]) => {
      if (!aiFeatures) throw new Error('Pro AI plan required');
      if (settings?.aiAutoGroupEnabled === false) throw new Error('Auto-group is turned off in Settings');
      if (!session?.access_token) throw new Error('Not authenticated');

      return aiPost<{ groups: { name: string; color: string; tabIds: number[] }[] }>(
        '/api/ai/group-tabs',
        { tabs },
        session.access_token
      );
    }
  });
}

export function useNameGroup() {
  const { session } = useAuth();
  const { aiFeatures } = useEntitlements();
  const { data: settings } = useAppSettings();

  return useMutation({
    onSuccess: () => { trackEvent('ai_feature_used', { feature_name: 'name' }); },
    // ponytail: no daily throttle — manual, always run it.
    mutationFn: async (tabs: Tab[]) => {
      if (!aiFeatures) throw new Error('Pro AI plan required');
      if (settings?.aiNameGroupEnabled === false) throw new Error('Name group is turned off in Settings');
      if (!session?.access_token) throw new Error('Not authenticated');

      return aiPost<{ name: string }>('/api/ai/name-group', { tabs }, session.access_token);
    }
  });
}

export function useSuggestSessions() {
  const { session } = useAuth();
  const { aiFeatures } = useEntitlements();
  const { data: settings } = useAppSettings();

  return useMutation({
    onSuccess: () => { trackEvent('ai_feature_used', { feature_name: 'suggest' }); },
    // Throttled — this is only ever invoked automatically by AIGroupSuggestion's
    // background effect (not a manual button), so it's the case the daily throttle
    // exists to protect.
    mutationFn: async (recentGroups: Group[]) => {
      if (!aiFeatures) throw new Error('Pro AI plan required');
      if (settings?.aiSuggestSessionsEnabled === false) throw new Error('Suggest sessions is turned off in Settings');
      if (!session?.access_token) throw new Error('Not authenticated');
      await enforceDailyThrottle('suggest-sessions', settings?.aiDailyThrottle ?? true);

      return aiPost<{ suggestion: string }>(
        '/api/ai/suggest-sessions',
        { groups: recentGroups.map((g) => ({ name: g.name, tabs: g.windows.flatMap((w) => w.tabs) })) },
        session.access_token
      );
    }
  });
}

export function useOrganizeTabs() {
  const { session } = useAuth();
  const { aiFeatures } = useEntitlements();
  const { data: settings } = useAppSettings();

  return useMutation({
    onSuccess: () => { trackEvent('ai_feature_used', { feature_name: 'organize' }); },
    // ponytail: no daily throttle — manual, always run it.
    mutationFn: async () => {
      if (!aiFeatures) throw new Error('Pro AI plan required');
      if (settings?.aiOrganizeEnabled === false) throw new Error('Organize is turned off in Settings');
      if (!session?.access_token) throw new Error('Not authenticated');

      return aiPost<{ runId: string; token: string }>(
        '/api/ai/organize',
        {}, // ponytail: no body — server derives userId from Bearer token
        session.access_token
      );
    }
  });
}

export function useTabSummary() {
  const { session } = useAuth();
  const { aiFeatures } = useEntitlements();
  const { data: settings } = useAppSettings();

  // ponytail: no daily throttle here — hover-to-preview is arguably user-initiated
  // (the user is actively hovering a specific tab), and per-URL results are already
  // cached for the popup session (see summaryCache in useTabPreview.ts), so repeat
  // hovers of the same tab don't re-hit the API anyway. A once-a-day cap would also
  // break the feature after the first hover of the day, which isn't the intent here.
  return useMutation({
    onSuccess: (data) => { if (data.summary) trackEvent('ai_summary_used'); },
    mutationFn: async ({ url, title }: { url: string; title: string }) => {
      if (!aiFeatures || !session?.access_token || settings?.aiTabSummaryEnabled === false) {
        return { summary: null };
      }

      return aiPost<{ summary: string }>(
        '/api/ai/tab-summary',
        { url, title },
        session.access_token
      );
    }
  });
}
