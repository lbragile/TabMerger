import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[TabMerger] Supabase env vars missing — cloud sync disabled');
}

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

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,
    storageKey: 'tabmerger-auth',
    storage: chromeStorage,
  },
});

export type SupabaseClient = typeof supabase;
