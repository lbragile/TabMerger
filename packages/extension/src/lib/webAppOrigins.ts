/**
 * The web origins a build trusts: the primary site (`VITE_WEB_APP_URL`) plus any extra sites
 * (`VITE_EXTRA_WEB_APP_URLS`, comma-separated). Used for everything that ACCEPTS a message from
 * the web app: `externally_connectable.matches` (wxt.config.ts), the Firefox web bridge's
 * content-script `matches`, and the background's check of who relayed a bridge message.
 *
 * Extras exist so a build keeps working while the site moves between hosts: installed builds
 * can't be reconfigured, so a build has to trust the new host before pages are served from it,
 * and keep trusting the old one until every installed build has updated. Anything that BUILDS a
 * URL (API calls, links, the sign-in redirect, Firefox's update_url) uses the primary only.
 *
 * Pure and dependency-free on purpose: wxt.config.ts imports it by relative path at config
 * load, before any `@/` alias exists.
 */

export interface WebAppOriginOptions {
  /**
   * Accept `http://localhost` / `http://127.0.0.1` extras. Only for development builds, which
   * talk to a local web app; every other build accepts https only.
   */
  allowLocalhostHttp: boolean;
}

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1']);

function fail(entry: string, reason: string): never {
  throw new Error(
    `VITE_EXTRA_WEB_APP_URLS: "${entry}" ${reason}. Each entry must be a bare https origin ` +
      'such as https://example.com (no path, query, hash, wildcard, port or credentials). ' +
      'Fix the value instead of shipping a build the web app cannot reach.'
  );
}

/**
 * Parses one extra entry strictly and returns its origin, or throws naming the bad entry.
 * Rejected: anything that isn't an absolute URL, a protocol other than https (http only for
 * localhost when `allowLocalhostHttp`), a path other than "/", a query or hash (even an empty
 * `?`/`#`), a wildcard, credentials, and an explicit port on a non-localhost host.
 */
export function parseExtraWebAppOrigin(entry: string, options: WebAppOriginOptions): string {
  if (entry.includes('*')) fail(entry, 'contains a wildcard');
  if (entry.includes('?')) fail(entry, 'has a query');
  if (entry.includes('#')) fail(entry, 'has a hash');
  if (entry.includes('@')) fail(entry, 'has credentials');
  if (/\s/.test(entry)) fail(entry, 'contains whitespace');

  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    return fail(entry, 'is not a valid URL');
  }

  const isLocalhost = LOCALHOST_NAMES.has(url.hostname);
  if (url.protocol === 'http:') {
    if (!(isLocalhost && options.allowLocalhostHttp)) fail(entry, 'is not https');
  } else if (url.protocol !== 'https:') {
    fail(entry, 'is not https');
  }
  if (!url.hostname) fail(entry, 'has no host');
  if (url.username || url.password) fail(entry, 'has credentials');
  if (url.pathname !== '/') fail(entry, 'has a path');
  if (url.port && !isLocalhost) fail(entry, 'has a port');
  return url.origin;
}

/**
 * Splits `VITE_EXTRA_WEB_APP_URLS` on commas, trims each entry, skips empty ones and returns
 * each entry's origin (see `parseExtraWebAppOrigin`), without duplicates. Throws on the first
 * invalid entry. Unset or blank input gives `[]`.
 */
export function parseExtraWebAppUrls(raw: string | undefined, options: WebAppOriginOptions): string[] {
  if (!raw) return [];
  const origins: string[] = [];
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const origin = parseExtraWebAppOrigin(entry, options);
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

/**
 * The primary origin (from `VITE_WEB_APP_URL`) followed by the extras, de-duplicated. The
 * primary keeps its existing rules (any http or https URL, reduced to its origin) and throws
 * only when it isn't an http(s) URL at all. An unset primary contributes nothing.
 */
export function resolveTrustedWebAppOrigins(
  primary: string | undefined,
  extras: string | undefined,
  options: WebAppOriginOptions
): string[] {
  const origins: string[] = [];
  if (primary) {
    let url: URL;
    try {
      url = new URL(primary);
    } catch {
      throw new Error(`VITE_WEB_APP_URL: "${primary}" is not a valid URL.`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`VITE_WEB_APP_URL: "${primary}" is not an http(s) URL.`);
    }
    origins.push(url.origin);
  }
  for (const origin of parseExtraWebAppUrls(extras, options)) {
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

/** One `<origin>/*` match pattern per origin, for `externally_connectable` and content scripts. */
export function toOriginMatchPatterns(origins: readonly string[]): string[] {
  return origins.map((origin) => `${origin}/*`);
}
