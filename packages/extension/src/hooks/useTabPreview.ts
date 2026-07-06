import { useState, useRef, useCallback } from 'react';
import { useTabSummary } from './useAI';

interface TabPreviewState {
  visible: boolean;
  summary: string | null;
  loading: boolean;
}

/**
 * Shows a hover popover anchored to the right of a tab title after a 400ms debounce.
 *
 * @param url       The tab's URL — used as the AI summary key.
 * @param title     The tab's title — displayed in the popover and sent to the AI.
 * @param aiEnabled Pass `true` for Pro AI users; `false` shows title + URL only, no AI call.
 */
export function useTabPreview(url: string, title: string, aiEnabled: boolean) {
  const [state, setState] = useState<TabPreviewState>({
    visible: false,
    summary: null,
    loading: false
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { mutateAsync: fetchSummary } = useTabSummary();

  const handleMouseEnter = useCallback(() => {
    timerRef.current = setTimeout(async () => {
      if (!aiEnabled) {
        // Non-AI users: show title + URL immediately, no network call
        setState({ visible: true, summary: null, loading: false });
        return;
      }
      setState((s) => ({ ...s, visible: true, loading: true }));
      try {
        const result = await fetchSummary({ url, title });
        setState({ visible: true, summary: result.summary ?? null, loading: false });
      } catch {
        setState({ visible: true, summary: null, loading: false });
      }
    }, 400);
  }, [url, title, fetchSummary, aiEnabled]);

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState({ visible: false, summary: null, loading: false });
  }, []);

  return { ...state, handleMouseEnter, handleMouseLeave };
}
