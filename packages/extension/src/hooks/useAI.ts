import { t } from '@/lib/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { trackEvent } from '@/lib/analytics';
import type { Tab, Group } from '@/lib/types';
import {
  AI_BYOK_KEY_HEADER,
  AI_ERROR_CODES,
  MANAGED_AI_PROVIDER,
  estimateAiCredits,
  isTourDemoGroup,
  type AiAction,
  type AiModelChoice,
  type AiSuggestionKind
} from '@tabmerger/shared';
import { useAuth } from './useAuth';
import { useEntitlements } from './useEntitlements';
import { useAppSettings } from './useAppSettings';
import { useAiUsage } from './useAiUsage';
import { useGroups } from './useGroups';
import { wasCalledToday, markCalledToday } from '@/lib/aiThrottle';
import { getEncryptionKeyState } from '@/lib/encryptionKey';
import { AI_ENABLED } from '@/lib/aiFlag';
import { getByokKey } from '@/lib/byokKey';
import { choiceForProvider, modelFor } from '@/lib/aiModel';
import { AiRequestError, QuotaExceededError, aiErrorMessage } from '@/lib/aiErrors';
import { sanitizeOrganizeActions } from '@/lib/organizeActions';

// No `export { … } from '@/lib/aiErrors'` here: WXT auto-imports every export of src/hooks, so a
// re-exported class gets auto-imported into the very file that declares it (a duplicate
// declaration that blanks the dev popup). Import the error classes from '@/lib/aiErrors'.

const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL as string;

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
    throw new Error(t('errors.aiOncePerDay'));
  }
  await markCalledToday(action);
}

/** The JSON error body of a failed AI request (`{ error, needed?, remaining? }`), when it has one. */
function parseErrorBody(text: string): Record<string, unknown> | null {
  try {
    const body: unknown = JSON.parse(text);
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface AiPostOptions {
  /** A BYOK user's own API key, sent in the `AI_BYOK_KEY_HEADER` header. Never in the body or a URL. */
  byokKey?: string;
}

/**
 * Shared cross-origin fetch helper for all AI API routes.
 * Sends a `Bearer` token because the extension runs on a different origin and
 * cannot use session cookies. The web app's API routes verify this JWT server-side.
 *
 * A failure throws {@link QuotaExceededError} for a 429 (out of TabMerger credits; BYOK errors
 * never use 429), else {@link AiRequestError} with the server's `AI_ERROR_CODES` code and a
 * translated message, or the raw status and text when the response carries no code.
 */
export async function aiPost<T>(path: string, body: unknown, token: string, options: AiPostOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
  if (options.byokKey) headers[AI_BYOK_KEY_HEADER] = options.byokKey;

  const res = await fetch(`${WEB_APP_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    const parsed = parseErrorBody(text);
    const code = typeof parsed?.error === 'string' ? parsed.error : null;
    if (res.status === 429 && (code === null || code === AI_ERROR_CODES.quotaExceeded)) {
      const err = new QuotaExceededError(`AI request failed: ${res.status} ${text}`);
      if (typeof parsed?.needed === 'number') err.needed = parsed.needed;
      if (typeof parsed?.remaining === 'number') err.remaining = parsed.remaining;
      throw err;
    }
    throw new AiRequestError(code, res.status, code ? aiErrorMessage(code) : `AI request failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<T>;
}

/** Derives isQuotaExceeded from a mutation's settled error so components can show a "buy more AI credits" prompt instead of a generic error. */
function withQuotaFlag<T extends { error: unknown }>(mutation: T): T & { isQuotaExceeded: boolean } {
  return { ...mutation, isQuotaExceeded: mutation.error instanceof QuotaExceededError };
}

/** What every AI mutation reads before it may send a request. */
function useAiRequestContext() {
  const { session } = useAuth();
  const { aiFeatures, aiMode } = useEntitlements();
  const { data: settings } = useAppSettings();
  const usage = useAiUsage();
  const queryClient = useQueryClient();
  const userId = session?.user?.id;

  /**
   * The model choice and (BYOK) key for a request about `tabs` tabs. Throws before anything is
   * sent when a BYOK user has no key saved on this device, or when a managed user's remaining
   * credits are known to be fewer than the request's estimate (the server would refuse it).
   * A chosen model from another provider than the request goes to is sent as `auto`.
   */
  const prepare = async (action: AiAction, tabs: number): Promise<{ model: AiModelChoice; options: AiPostOptions }> => {
    if (aiMode === 'byok') {
      const saved = await getByokKey(userId);
      if (!saved) {
        throw new AiRequestError(AI_ERROR_CODES.byokKeyMissing, 0, aiErrorMessage(AI_ERROR_CODES.byokKeyMissing));
      }
      return { model: choiceForProvider(settings?.aiModel, saved.provider), options: { byokKey: saved.key } };
    }
    // Managed (or the mode isn't known yet, and the server decides): always Anthropic. Only a
    // known balance is checked.
    const model = choiceForProvider(settings?.aiModel, MANAGED_AI_PROVIDER);
    if (!usage.loading && usage.known) {
      const needed = estimateAiCredits(modelFor(model, action), action, tabs);
      if (needed > usage.remaining) {
        const err = new QuotaExceededError('AI request failed: 429 quota exceeded (client-side estimate)');
        err.needed = needed;
        err.remaining = usage.remaining;
        throw err;
      }
    }
    return { model, options: {} };
  };

  /** A call may have used credits (even a failed one), so the balance shown is read again. */
  const refreshUsage = () => {
    if (aiMode !== 'byok') void queryClient.invalidateQueries({ queryKey: ['aiUsage'] });
  };

  return { session, aiFeatures, settings, prepare, refreshUsage };
}

/** `session.access_token`, or throws the "not authenticated" error. */
function requireToken(session: Session | null): string {
  if (!session?.access_token) throw new Error(t('errors.notAuthenticated'));
  return session.access_token;
}

const countTabs = (groups: { tabs: unknown[] }[]) => groups.reduce((n, g) => n + g.tabs.length, 0);

export function useAutoGroup() {
  const { session, aiFeatures, settings, prepare, refreshUsage } = useAiRequestContext();

  return withQuotaFlag(useMutation({
    onSuccess: () => { trackEvent('ai_feature_used', { feature_name: 'group' }); trackEvent('ai_auto_group_used'); },
    onSettled: refreshUsage,
    // ponytail: no daily throttle — this is a manual button click, always run it
    // (subject to the existing server-side monthly quota only).
    mutationFn: async (tabs: Tab[]) => {
      if (!AI_ENABLED) throw new Error('AI features are coming soon');
      if (!aiFeatures) throw new Error(t('errors.proAiRequired'));
      if (settings?.aiAutoGroupEnabled === false) throw new Error('Auto-group is turned off in Settings');
      const token = requireToken(session);
      const { model, options } = await prepare('groupTabs', tabs.length);

      return aiPost<{ groups: { name: string; color: string; tabIds: number[] }[] }>(
        '/api/ai/group-tabs',
        { tabs, model },
        token,
        options
      );
    }
  }));
}

export function useNameGroup() {
  const { session, aiFeatures, settings, prepare, refreshUsage } = useAiRequestContext();

  return withQuotaFlag(useMutation({
    onSuccess: () => { trackEvent('ai_feature_used', { feature_name: 'name' }); },
    onSettled: refreshUsage,
    // ponytail: no daily throttle — manual, always run it.
    mutationFn: async (tabs: Tab[]) => {
      if (!AI_ENABLED) throw new Error('AI features are coming soon');
      if (!aiFeatures) throw new Error(t('errors.proAiRequired'));
      if (settings?.aiNameGroupEnabled === false) throw new Error(t('errors.nameGroupOff'));
      const token = requireToken(session);
      const { model, options } = await prepare('nameGroup', tabs.length);

      return aiPost<{ name: string }>('/api/ai/name-group', { tabs, model }, token, options);
    }
  }));
}

export function useSuggestSessions() {
  const { session, aiFeatures, settings, prepare, refreshUsage } = useAiRequestContext();

  return withQuotaFlag(useMutation({
    onSuccess: () => { trackEvent('ai_feature_used', { feature_name: 'suggest' }); },
    onSettled: refreshUsage,
    // Throttled — this is only ever invoked automatically by AIGroupSuggestion's
    // background effect (not a manual button), so it's the case the daily throttle
    // exists to protect.
    mutationFn: async (recentGroups: Group[]) => {
      if (!AI_ENABLED) throw new Error('AI features are coming soon');
      if (!aiFeatures) throw new Error(t('errors.proAiRequired'));
      if (settings?.aiSuggestSessionsEnabled === false) throw new Error(t('errors.suggestSessionsOff'));
      const token = requireToken(session);
      // `id` is sent so the server can return staleGroupIds the UI can act on per group.
      const groups = recentGroups.map((g) => ({ id: g.id, name: g.name, tabs: g.windows.flatMap((w) => w.tabs) }));
      const { model, options } = await prepare('suggestSessions', countTabs(groups));
      await enforceDailyThrottle('suggest-sessions', settings?.aiDailyThrottle ?? true);

      // `suggestion` is a deprecated alias for `message` — drop it once AIGroupSuggestion migrates.
      // `kind` is missing from a server older than the Merge action: the banner reads that as archive.
      return aiPost<{ message: string; staleGroupIds: string[]; kind?: AiSuggestionKind; suggestion: string }>(
        '/api/ai/suggest-sessions',
        { groups, model },
        token,
        options
      );
    }
  }));
}

export function useOrganizeTabs() {
  const { session, aiFeatures, settings, prepare, refreshUsage } = useAiRequestContext();
  const { data: groupsState } = useGroups();

  return withQuotaFlag(useMutation({
    onSuccess: () => { trackEvent('ai_feature_used', { feature_name: 'organize' }); },
    onSettled: refreshUsage,
    // ponytail: no daily throttle — manual, always run it.
    mutationFn: async () => {
      if (!AI_ENABLED) throw new Error('AI features are coming soon');
      if (!aiFeatures) throw new Error(t('errors.proAiRequired'));
      if (settings?.aiOrganizeEnabled === false) throw new Error(t('errors.organizeOff'));
      const token = requireToken(session);

      // Once encryption is set up, `groups.windows` in Supabase is ciphertext the
      // server can't read, so the plaintext for the prompt has to come from our
      // already-decrypted local state. Array order carries the "Now Open is
      // index 0" invariant, and `permanent` is sent explicitly so the server
      // doesn't have to infer it.
      // Only a confirmed "no key" lets the server read the rows itself: when the check failed the
      // account may be encrypted, and the server would then be reading ciphertext.
      const localGroups = groupsState?.available.filter((g) => !isTourDemoGroup(g)).map((g) => ({
        id: g.id,
        name: g.name,
        permanent: g.permanent ?? false,
        tabs: g.windows.flatMap((w) => w.tabs)
      }));
      const groups = (await getEncryptionKeyState()) !== 'absent' ? localGroups : undefined;
      // The estimate counts the local tabs either way: the server's rows hold the same groups
      const { model, options } = await prepare('organize', countTabs(localGroups ?? []));

      const reply = await aiPost<unknown>(
        '/api/ai/organize',
        // ponytail: no groups for unencrypted users — the server reads the DB itself.
        groups?.length ? { groups, model } : { model },
        token,
        options
      );
      // AI output through our server: untrusted. Only well-formed actions on this device's saved
      // groups are kept (never Now Open or the tour's practice groups); the popup reviews them.
      return { actions: sanitizeOrganizeActions(reply, groupsState?.available) };
    }
  }));
}

export function useTabSummary() {
  const { session, aiFeatures, settings, prepare, refreshUsage } = useAiRequestContext();

  // ponytail: no daily throttle here — hover-to-preview is arguably user-initiated
  // (the user is actively hovering a specific tab), and per-URL results are already
  // cached for the popup session (see summaryCache in useTabPreview.ts), so repeat
  // hovers of the same tab don't re-hit the API anyway. A once-a-day cap would also
  // break the feature after the first hover of the day, which isn't the intent here.
  return withQuotaFlag(useMutation({
    onSuccess: (data) => { if (data.summary) trackEvent('ai_summary_used'); },
    onSettled: refreshUsage,
    mutationFn: async ({ url, title }: { url: string; title: string }) => {
      if (!AI_ENABLED || !aiFeatures || !session?.access_token || settings?.aiTabSummaryEnabled === false) {
        return { summary: null };
      }
      const { model, options } = await prepare('tabSummary', 1);

      return aiPost<{ summary: string }>(
        '/api/ai/tab-summary',
        { url, title, model },
        session.access_token,
        options
      );
    }
  }));
}
