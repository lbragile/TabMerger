const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL as string | undefined;
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_API_KEY as string | undefined;
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com';

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
 * Fires a GA4 event via the server-side proxy at `${VITE_WEB_APP_URL}/api/track` —
 * the extension no longer holds the GA4 measurement ID or API secret (both are
 * server-only now), so nothing in the shipped bundle can be extracted to spoof events.
 * Fire-and-forget — errors are swallowed.
 */
export function trackEvent(name: string, params?: Record<string, string | number>): void {
  trackPostHogEvent(name, params); // mirror every GA4 event to PostHog (no-ops if unconfigured)
  if (!WEB_APP_URL) return; // ponytail: no-op if not configured
  getClientId().then((clientId) => {
    fetch(`${WEB_APP_URL}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: name, params, client_id: clientId }),
    }).catch(() => {}); // fire-and-forget
  }).catch(() => {});
}

/**
 * Fires a PostHog event via the HTTP Capture API — not the `posthog-js` SDK.
 * The SDK's optional extensions (toolbar, exception autocapture, session replay
 * recorder) lazy-load additional `<script>` tags from PostHog's CDN, which MV3's
 * default `script-src 'self'` popup CSP blocks. Same constraint that forced GA4
 * onto the Measurement Protocol here. Session replay is therefore not available
 * via this path — only plain event capture.
 * No-ops silently when `VITE_POSTHOG_API_KEY` is unset.
 */
export function trackPostHogEvent(name: string, properties?: Record<string, string | number>): void {
  if (!POSTHOG_KEY) return; // ponytail: no-op if not configured
  getClientId().then((clientId) => {
    fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event: name,
        distinct_id: clientId,
        properties,
      }),
    }).catch(() => {}); // fire-and-forget
  }).catch(() => {});
}
