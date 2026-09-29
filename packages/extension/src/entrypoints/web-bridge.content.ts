// Firefox-only bridge between the TabMerger website and this extension.
//
// Firefox doesn't support `externally_connectable` for web pages (MDN;
// https://bugzil.la/1319168), so `chrome.runtime.sendMessage(extensionId, ...)` from the
// website silently fails there — see .claude/plans/firefox-edge-beta-spec.md §3/§6.3. This
// content script relays the same three messages (`PING`, `SYNC_AUTH`, `SYNC_NOW`) between
// `window.postMessage` (page side, packages/web/lib/extensionMessaging.ts) and
// `chrome.runtime.sendMessage` (this extension's background script), which content scripts
// CAN always reach regardless of `externally_connectable`.
//
// `include: ['firefox']` (checked in wxt's find-entrypoints.mjs) means this entrypoint is
// skipped entirely for Chrome/Edge manifests — no content_scripts entry, no host permission,
// no install/update warning for existing Chromium users. Chrome and Edge keep using
// `externally_connectable` in wxt.config.ts.
//
// `matches` reads `import.meta.env.VITE_WEB_APP_URL`, which WXT resolves per build mode the
// same way it resolves the popup/background bundles (production/beta/local dev each get their
// own .env file) — this is a real vite build of this file (wxt.builder.importEntrypoints), not
// a naive static parse, so the env substitution applies here too.
import { WEB_BRIDGE, WEBSITE_TO_EXTENSION_TYPES, type ExtensionMessageType } from '@tabmerger/shared';

const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL;

export default defineContentScript({
  matches: WEB_APP_URL ? [`${WEB_APP_URL}/*`] : [],
  include: ['firefox'],
  // Runs in the page's own JS context isolation (content script "isolated world"), not
  // MAIN world — window.postMessage still crosses that boundary fine, and this script never
  // touches the page's own DOM/JS, only listens for postMessage.
  main() {
    const ALLOWED_TYPES = new Set<string>(WEBSITE_TO_EXTENSION_TYPES);

    window.addEventListener('message', (event: MessageEvent) => {
      // Reject anything not from this exact page, in this exact window, on this exact origin —
      // a compromised iframe or another extension's content script could otherwise spoof a
      // SYNC_AUTH message carrying attacker-controlled tokens.
      if (event.source !== window) return;
      if (event.origin !== location.origin) return;

      const data = event.data as
        | { source?: string; requestId?: string; type?: ExtensionMessageType; payload?: unknown }
        | undefined;
      if (!data || data.source !== WEB_BRIDGE.WEBSITE_SOURCE) return;
      if (!data.type || !ALLOWED_TYPES.has(data.type)) return;

      const { requestId, type, payload } = data;

      chrome.runtime
        .sendMessage({ type, ...(payload && typeof payload === 'object' ? payload : {}) })
        .then((response) => {
          // Never post back to '*' — only this exact origin, and never log/forward the
          // SYNC_AUTH payload itself (only the ack the background handler returns).
          window.postMessage({ source: WEB_BRIDGE.EXTENSION_SOURCE, requestId, response }, location.origin);
        })
        .catch((err) => {
          window.postMessage(
            {
              source: WEB_BRIDGE.EXTENSION_SOURCE,
              requestId,
              response: { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) },
            },
            location.origin
          );
        });
    });

    // Announce once on load so the page can detect the bridge without a round trip.
    window.postMessage(
      { source: WEB_BRIDGE.EXTENSION_SOURCE, type: WEB_BRIDGE.READY, version: chrome.runtime.getManifest().version },
      location.origin
    );
  },
});
