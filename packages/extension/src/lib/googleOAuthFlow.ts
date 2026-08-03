import { supabase } from '@/lib/supabase';

/**
 * Runs the Google OAuth flow via chrome.identity.launchWebAuthFlow.
 *
 * Must be called from the background service worker, not the popup — MV3 popups
 * close the instant they lose focus, and launchWebAuthFlow opens a window that
 * steals focus, destroying the popup's JS context (and the pending promise)
 * before the flow can complete. The background stays alive regardless, and
 * setSession()/exchangeCodeForSession() below persist to chrome.storage.local,
 * which the popup's own Supabase client picks up via chrome.storage.onChanged
 * whenever it's next open.
 */
export async function runGoogleOAuthFlow(): Promise<void> {
  if (!chrome?.identity) {
    throw new Error('Google sign-in is unavailable in this environment');
  }

  const redirectUrl = chrome.identity.getRedirectURL();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Google sign-in did not return an authorization URL');

  const responseUrl = await new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true }, (redirectedTo) => {
      if (chrome.runtime.lastError || !redirectedTo) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'Google sign-in was cancelled'));
        return;
      }
      resolve(redirectedTo);
    });
  });

  const url = new URL(responseUrl);
  const code = url.searchParams.get('code');
  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) throw exchangeError;
    return;
  }

  // Fallback: implicit flow returns tokens in the hash fragment instead of a code.
  const hashParams = new URLSearchParams(url.hash.slice(1));
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error: setError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (setError) throw setError;
    return;
  }

  throw new Error('Google sign-in did not return a session');
}
