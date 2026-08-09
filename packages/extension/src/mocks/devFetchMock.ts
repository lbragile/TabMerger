import { aiFixtures } from './handlers';
import { incrementDevAiUsage, getDevAiUsage } from './devAiUsage';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';

const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL as string;

// ponytail: fire-and-forget, best-effort sync of the local dev mock counter to the
// real Supabase ai_usage table, so server-side quota enforcement stays exercisable
// while clicking through AI features in dev — never surfaces errors to the caller
// (no session yet, network down, or /api/ai/dev-usage 404ing outside dev deploys
// are all expected/ignorable here).
async function syncDevUsageToServer(realFetch: typeof window.fetch) {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    const count = await getDevAiUsage();
    const res = await realFetch(`${WEB_APP_URL}/api/ai/dev-usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ count }),
    });
    if (!res.ok) return;

    queryClient.invalidateQueries({ queryKey: ['aiUsage', session.user.id] });
  } catch {
    // silent — dev-only convenience sync, never block/surface to the caller
  }
}

/**
 * Dev-only fetch interception for /api/ai/* calls.
 *
 * ponytail: originally used MSW's setupWorker (service-worker based), but MV3
 * extension popup pages (chrome-extension://) don't reliably support
 * registering a second, page-scoped service worker alongside the extension's
 * own SW infrastructure — the registration failed silently and real requests
 * fell through to the live web app. Patching `window.fetch` directly has no
 * such dependency: no SW registration, no CSP edge case, works anywhere
 * `fetch` is called from this page context.
 *
 * Call once, synchronously, before any AI hook can fire.
 */
export function installDevFetchMock() {
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const pathname = new URL(url, window.location.href).pathname;
    const fixture = aiFixtures[pathname];

    if (fixture) {
      console.info(`[dev-mock] intercepted ${pathname}`);
      // fire-and-forget, mirrors server-side usage tracking; chain the real-DB sync
      // after the local increment resolves so it posts the up-to-date count
      void incrementDevAiUsage().then(() => syncDevUsageToServer(realFetch));
      const body = typeof fixture === 'function' ? fixture(JSON.parse((init?.body as string) ?? '{}')) : fixture;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return realFetch(input, init);
  };
}
