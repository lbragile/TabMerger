/**
 * Page metadata (og:image / description) for the Tab Preview hover tooltip.
 *
 * Fetched from the web app's server-side scraper (packages/web/app/api/og-preview)
 * instead of injecting a content script into the tab — this needs NO host permission
 * at all (no `<all_urls>`, no `scripting`), keeping the extension out of Chrome Web
 * Store's elevated review tier entirely. Title comes from chrome.tabs (tab.title),
 * already available without any extra permission.
 */
export interface PageMeta {
  description: string | null;
  ogImage: string | null;
}

/** Returns page metadata for a URL via the web app's server-side scraper, or null on any failure. */
export async function getPageMetaForTab(url: string): Promise<PageMeta | null> {
  const webAppUrl = import.meta.env.VITE_WEB_APP_URL as string | undefined;
  if (!webAppUrl || !url) return null;
  try {
    const res = await fetch(`${webAppUrl}/api/og-preview?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { ogImage?: string | null; description?: string | null };
    return { ogImage: data.ogImage ?? null, description: data.description ?? null };
  } catch {
    return null;
  }
}
