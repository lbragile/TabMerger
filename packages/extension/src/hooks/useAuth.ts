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
    chrome.storage.local.onChanged.addListener(storageHandler);

    return () => {
      listener.subscription.unsubscribe();
      chrome.storage.local.onChanged.removeListener(storageHandler);
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

  return { ...state, signIn, signUp, resetPassword, signOut };
}
