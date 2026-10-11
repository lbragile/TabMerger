/**
 * Key-cache bookkeeping that needs nothing but `sessionStorage`. It lives apart from
 * `context.tsx` because the navbar's sign-out form (on every page) calls it: importing it from
 * the context module would ship the Supabase client and the whole encryption stack to visitors
 * who never sign in.
 */

export const SESSION_KEY_PREFIX = 'tabmerger:dataKey:'

/**
 * Clears every cached data key in this tab, regardless of account. Used on
 * sign-out, where the signing-out user's id isn't worth threading through
 * just to look up one key — only one account is ever signed in per tab.
 */
export function clearAllCachedDataKeys(): void {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(SESSION_KEY_PREFIX)) sessionStorage.removeItem(key)
  }
}
