import type { MouseEvent } from 'react';
import { DEFAULT_LOCALE, isSupportedLocale, toHttpUrl } from '@tabmerger/shared';

/**
 * The TabMerger website's home page for this build, in the given language, for the header logo.
 *
 * `webAppUrl` is the build's `VITE_WEB_APP_URL` (localhost in development, the preview site in
 * beta builds, the public site in stable builds) and is treated as untrusted: anything that is
 * not an absolute http(s) URL gives `undefined`, so the caller renders no link. Only its origin is
 * kept (no path, query, hash or credentials).
 *
 * The path is always the language's prefixed home, English included (`/en`, `/de`, `/pt-BR`).
 * The web app routes `as-needed`, so `/en` redirects to `/` and sets its `NEXT_LOCALE` cookie to
 * English; the unprefixed `/` instead follows an older cookie, so a visitor who once chose
 * another language on the site would land in that one. An unknown tag and the dev-only
 * pseudo-locale (`en-XA`) link to `/en` (the default locale).
 */
export function websiteHomeUrl(webAppUrl: unknown, locale: string | undefined): string | undefined {
  const base = toHttpUrl(webAppUrl);
  if (!base) return undefined;
  const path = `/${isSupportedLocale(locale) ? locale : DEFAULT_LOCALE}`;
  return new URL(path, new URL(base).origin).toString();
}

/**
 * Click handler for a link to a web page from the popup: opens `url` in a new active tab through
 * `chrome.tabs.create` (as the Settings links do), which works from Chrome and Firefox popups.
 * When the tabs API is missing the click is left to the link's own `href` / `target="_blank"`,
 * and when it rejects the page is opened with `window.open` instead.
 */
export function openInNewTab(event: MouseEvent<HTMLAnchorElement>, url: string): void {
  const create = globalThis.chrome?.tabs?.create;
  if (typeof create !== 'function') return;
  event.preventDefault();
  const fallback = () => {
    globalThis.open?.(url, '_blank', 'noopener,noreferrer');
  };
  try {
    const result: unknown = chrome.tabs.create({ url, active: true });
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      void (result as Promise<unknown>).catch(fallback);
    }
  } catch {
    fallback();
  }
}
