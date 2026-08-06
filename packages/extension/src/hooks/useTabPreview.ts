import { useState, useRef, useCallback } from 'react';
import { useTabSummary } from './useAI';

// ponytail: module-level cache — lives for the popup session, cleared on close
const summaryCache = new Map<string, string>();

interface TabPreviewState {
  visible: boolean;
  summary: string | null;
  ogImage: string | null;
  loading: boolean;
}

async function fetchOgImage(tabId: number, url?: string): Promise<string | null> {
  let id = tabId > 0 ? tabId : 0;
  // For saved tabs (id=0), look up a live Chrome tab by URL
  if (!id && url) {
    try {
      const matches = await chrome.tabs.query({ url });
      id = matches[0]?.id ?? 0;
    } catch { /* ignore */ }
  }
  if (!id) return null;
  try {
    const meta = await chrome.tabs.sendMessage(id, { type: 'GET_PAGE_META' });
    return (meta as { ogImage?: string | null })?.ogImage ?? null;
  } catch {
    return null;
  }
}

/**
 * Shows a hover popover anchored to the right of a tab title after a 400ms debounce.
 *
 * @param url            The tab's URL — used as the AI summary key.
 * @param title          The tab's title — displayed in the popover and sent to the AI.
 * @param aiEnabled      Pass `true` for Pro AI users; `false` shows title + URL + ogImage only.
 * @param tabId          Chrome tab ID for live tabs; 0 or omitted for saved tabs (skips OG fetch).
 * @param storedOgImage  Already-persisted OG image for saved tabs — skips the live fetch when set.
 */
export function useTabPreview(url: string, title: string, aiEnabled: boolean, tabId?: number, storedOgImage?: string) {
  const [state, setState] = useState<TabPreviewState>({
    visible: false,
    summary: null,
    ogImage: null,
    loading: false
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceRef = useRef(false);
  const { mutateAsync: fetchSummary } = useTabSummary();

  const handleMouseEnter = useCallback(() => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    timerRef.current = setTimeout(async () => {
      graceRef.current = true;
      setTimeout(() => { graceRef.current = false; }, 500);
      setState((s) => ({ ...s, visible: true, loading: true }));
      try {
        const ogImage = storedOgImage ?? await fetchOgImage(tabId ?? 0, url);
        const cached = aiEnabled ? summaryCache.get(url) ?? null : null;
        setState({ visible: true, summary: cached, ogImage: ogImage ?? null, loading: false });
      } catch {
        setState({ visible: true, summary: null, ogImage: null, loading: false });
      }
    }, 400);
  }, [url, aiEnabled, tabId, storedOgImage]);

  /** Click-triggered AI summary fetch — reuses the module-level cache. */
  const generateSummary = useCallback(async () => {
    const cached = summaryCache.get(url);
    if (cached) {
      setState((s) => ({ ...s, summary: cached }));
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    try {
      const summary = (await fetchSummary({ url, title })).summary ?? null;
      if (summary) summaryCache.set(url, summary);
      setState((s) => ({ ...s, summary, loading: false }));
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, [url, title, fetchSummary]);

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (graceRef.current) return;
    leaveTimerRef.current = setTimeout(() => {
      setState({ visible: false, summary: null, ogImage: null, loading: false });
    }, 300);
  }, []);

  const cancelLeave = useCallback(() => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
  }, []);

  return { ...state, handleMouseEnter, handleMouseLeave, cancelLeave, generateSummary };
}
