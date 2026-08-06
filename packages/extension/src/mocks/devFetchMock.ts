import { aiFixtures } from './handlers';

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
      const body = typeof fixture === 'function' ? fixture(JSON.parse((init?.body as string) ?? '{}')) : fixture;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return realFetch(input, init);
  };
}
