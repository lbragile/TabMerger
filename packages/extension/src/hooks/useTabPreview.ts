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

/**
 * Shows a hover popover anchored to the right of a tab title after a 400ms debounce.
 *
 * @param url            The tab's URL — used as the AI summary key.
 * @param title          The tab's title — displayed in the popover and sent to the AI.
 * @param aiEnabled      Pass `true` for Pro AI users; `false` shows title + URL + ogImage only.
 * @param tabId          Unused — kept for call-site compatibility. There is no content
 *                        script to fetch a live OG image for; only `storedOgImage` is shown.
 * @param storedOgImage  Already-persisted `Tab.ogImage`, if any — a legacy field last written
 *                        by a since-removed content script; carried forward on copy/move but
 *                        never newly populated by current code. Distinct from the opt-in
 *                        preview-image fetch (see TabPreview.tsx / tabAccess.ts), whose result
 *                        is shown in the tooltip only and is never saved back to the tab.
 */
export function useTabPreview(url: string, title: string, aiEnabled: boolean, _tabId?: number, storedOgImage?: string) {
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
      // No content script exists to fetch a live OG image — only a `storedOgImage`
      // already persisted on the tab (or none) is ever shown here.
      const cached = aiEnabled ? summaryCache.get(url) ?? null : null;
      setState({ visible: true, summary: cached, ogImage: storedOgImage ?? null, loading: false });
    }, 400);
  }, [url, aiEnabled, storedOgImage]);

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
