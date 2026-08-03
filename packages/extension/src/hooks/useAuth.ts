import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

export function useAuth(): AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
} {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    loading: true
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState({ session: data.session, user: data.session?.user ?? null, loading: false });
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ session, user: session?.user ?? null, loading: false });
    });

    // When the background writes a web-app session into chrome.storage.local,
    // re-read it so the popup reacts without needing an explicit poll.
    const storageHandler = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('tabmerger-auth' in changes) {
        supabase.auth.getSession().then(({ data }) => {
          setState({ session: data.session, user: data.session?.user ?? null, loading: false });
        });
      }
    };
    // ponytail: guard — some test environments replace globalThis.chrome wholesale
    // without a `storage` key (same pattern as the chrome.identity guard elsewhere).
    chrome?.storage?.local?.onChanged?.addListener(storageHandler);

    return () => {
      listener.subscription.unsubscribe();
      chrome?.storage?.local?.onChanged?.removeListener(storageHandler);
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  // Attaches a password credential to the current session's account — needed for
  // accounts created via Google/magic-link, which have no password to fall back on.
  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  };

  // Popups close on blur, so the user finishes this in a browser tab, not the popup.
  // The content script (src/entrypoints/content.ts) already scans the web app's
  // localStorage for the resulting Supabase session and forwards it to the
  // background via a SYNC_AUTH message — no extra hand-off needed here.
  const signInWithMagicLink = async (email: string) => {
    const webAppUrl = import.meta.env.VITE_WEB_APP_URL as string | undefined;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: webAppUrl ? { emailRedirectTo: `${webAppUrl}/api/auth/callback` } : undefined,
    });
    if (error) throw error;
  };

  // Delegated to the background service worker, not run here — MV3 popups close
  // the instant they lose focus, and chrome.identity.launchWebAuthFlow opens a
  // window that steals it, destroying the popup's JS context (and this promise)
  // before the flow could complete. See lib/googleOAuthFlow.ts's doc comment.
  const signInWithGoogle = async () => {
    // ponytail: guard — some test environments replace globalThis.chrome wholesale
    // without a `runtime` key (same pattern as the chrome.storage guard above).
    if (!chrome?.runtime) {
      throw new Error('Google sign-in is unavailable in this environment');
    }
    const response = (await chrome.runtime.sendMessage({ type: 'SIGN_IN_WITH_GOOGLE' })) as
      | { ok: boolean; error?: string }
      | undefined;
    if (!response?.ok) {
      throw new Error(response?.error ?? 'Google sign-in failed');
    }
  };

  return { ...state, signIn, signUp, resetPassword, signInWithMagicLink, signInWithGoogle, updatePassword, signOut };
}
