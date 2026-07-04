import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[TabMerger] Supabase env vars missing — cloud sync disabled');
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,
    storageKey: 'tabmerger-auth',
    storage: {
      getItem: (key) => Promise.resolve(localStorage.getItem(key)),
      setItem: (key, value) => Promise.resolve(void localStorage.setItem(key, value)),
      removeItem: (key) => Promise.resolve(void localStorage.removeItem(key))
    }
  }
});

export type SupabaseClient = typeof supabase;
