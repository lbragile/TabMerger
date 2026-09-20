import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/**
 * True when real Supabase credentials were supplied at build time. False in any build/test run
 * missing `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` — callers that talk to Supabase
 * (syncEngine, deviceSessions, useEntitlements, useSync, etc.) can check this to skip network
 * calls and report "sync unavailable" instead of letting a request fail against a placeholder
 * host with a confusing error.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn('[TabMerger] Supabase env vars missing — cloud sync disabled');
}

// ponytail: `createClient('')` THROWS at construction time (`supabaseUrl is required` —
// validateSupabaseUrl in @supabase/supabase-js@2.x), it does not degrade gracefully. Every
// caller of this module (syncEngine.ts, deviceSessions.ts, useEntitlements.ts, useSync.ts) is
// imported transitively by the popup entrypoint, so a missing env var previously crashed the
// whole popup at import time instead of just disabling cloud sync as the warning above implies.
// `.invalid` is an RFC 2606-reserved TLD guaranteed to never resolve — safe placeholder host that
// can't accidentally hit a real endpoint. Real requests against it fail fast via normal DNS/
// network error paths that callers already handle (try/catch, `{ error } => return null`, etc.);
// `isSupabaseConfigured` lets callers skip the attempt entirely instead of relying on that.
const FALLBACK_URL = 'https://supabase-not-configured.invalid';
const FALLBACK_KEY = 'not-configured';

// ponytail: chrome.storage.local instead of localStorage so background, popup, and
// content scripts all share the same session store — required for the web-app auth
// bridge (content script forwards token → background → setSession here).
// ponytail: guard chrome.storage — undefined in some test environments whose mocks
// replace `globalThis.chrome` wholesale without a `storage` key (same pattern as the
// existing chrome.identity guard). Falls back to a no-op store rather than crashing
// the module-level Supabase client init.
export const chromeStorage = {
  getItem: async (key: string): Promise<string | null> => {
    if (!chrome?.storage?.local) return null;
    const result = await chrome.storage.local.get(key);
    return (result[key] as string | undefined) ?? null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (!chrome?.storage?.local) return;
    await chrome.storage.local.set({ [key]: value });
  },
  removeItem: async (key: string): Promise<void> => {
    if (!chrome?.storage?.local) return;
    await chrome.storage.local.remove(key);
  },
};

export const supabase = createClient(supabaseUrl || FALLBACK_URL, supabaseAnonKey || FALLBACK_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'tabmerger-auth',
    storage: chromeStorage,
  },
});

export type SupabaseClient = typeof supabase;
