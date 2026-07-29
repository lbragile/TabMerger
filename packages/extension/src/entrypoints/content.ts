const WEB_APP_ORIGIN = (import.meta.env.VITE_WEB_APP_URL as string | undefined) ?? '';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // --- Web-app auth bridge -------------------------------------------------
    // When the user signs in via the web app, Supabase stores the session in
    // the web app's localStorage. The extension cannot read that directly
    // (different origin) but this content script runs in the page context and
    // CAN read it. We scan for an access_token and forward it to the background
    // which calls supabase.auth.setSession() so the popup picks it up from
    // chrome.storage.local.
    if (WEB_APP_ORIGIN && location.origin === new URL(WEB_APP_ORIGIN).origin) {
      const tryForwardAuth = () => {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;
          try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            if (typeof parsed.access_token === 'string' && typeof parsed.refresh_token === 'string') {
              chrome.runtime.sendMessage({
                type: 'SYNC_AUTH',
                accessToken: parsed.access_token,
                refreshToken: parsed.refresh_token,
              });
              break;
            }
          } catch { /* not JSON */ }
        }
      };

      tryForwardAuth();
      // Also fire on localStorage writes (e.g. after sign-in completes on the same page)
      window.addEventListener('storage', tryForwardAuth);
    }
    // -------------------------------------------------------------------------

    // --- Extension-installed signal for the web app --------------------------
    // Lets dashboard pages detect the extension is installed without any
    // reliable browser API for that. Only fires on the web app's own origin
    // (no reason to broadcast on every page the content script runs on).
    // Web app listens via window.addEventListener('message', ...) and checks
    // event.data.source === 'tabmerger-extension' && event.data.type === 'INSTALLED'.
    if (WEB_APP_ORIGIN && location.origin === new URL(WEB_APP_ORIGIN).origin) {
      window.postMessage(
        {
          source: 'tabmerger-extension',
          type: 'INSTALLED',
          version: chrome.runtime.getManifest().version
        },
        window.location.origin
      );
    }
    // -------------------------------------------------------------------------

    // Expose page metadata for tab preview (title, og:description, etc.)
    const getMeta = () => {
      const ogDesc = document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute('content');
      const metaDesc = document
        .querySelector('meta[name="description"]')
        ?.getAttribute('content');
      const ogImage = document
        .querySelector('meta[property="og:image"]')
        ?.getAttribute('content') ?? null;

      return {
        title: document.title,
        description: ogDesc ?? metaDesc ?? null,
        url: location.href,
        ogImage
      };
    };

    // Listen for metadata requests from the extension
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'GET_PAGE_META') {
        sendResponse(getMeta());
        return true;
      }
      if (msg?.type === 'SET_TAB_TITLE') {
        try { document.title = msg.title as string; } catch { /* page may block assignment */ }
        return false;
      }
    });
  }
});
