const MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined;
const API_SECRET = import.meta.env.VITE_GA4_API_SECRET as string | undefined;

async function getClientId(): Promise<string> {
  const stored = await chrome.storage.local.get('ga_client_id');
  if (stored.ga_client_id) return stored.ga_client_id as string;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ ga_client_id: id });
  return id;
}

/**
 * SHA-256 hashes a Supabase user ID for GA4 user_id — avoids sending raw UUIDs to Google.
 * Returns a hex string. Called by the background script before sending the first event.
 */
export async function hashUserId(userId: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fires a GA4 Measurement Protocol event. Fire-and-forget — errors are swallowed.
 * No-ops silently when `VITE_GA4_MEASUREMENT_ID` or `VITE_GA4_API_SECRET` are unset
 * (i.e. in local dev or CI), so it's safe to call unconditionally everywhere.
 */
export function trackEvent(name: string, params?: Record<string, string | number>): void {
  if (!MEASUREMENT_ID || !API_SECRET) return; // ponytail: no-op if not configured
  getClientId().then((clientId) => {
    fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`,
      {
        method: 'POST',
        body: JSON.stringify({ client_id: clientId, events: [{ name, params }] }),
      }
    ).catch(() => {}); // fire-and-forget
  }).catch(() => {});
}
