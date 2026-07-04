import { useState, useRef, useCallback } from 'react';
import { useTabSummary } from './useAI';

interface TabPreviewState {
  visible: boolean;
  summary: string | null;
  loading: boolean;
}

export function useTabPreview(url: string, title: string) {
  const [state, setState] = useState<TabPreviewState>({
    visible: false,
    summary: null,
    loading: false
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { mutateAsync: fetchSummary } = useTabSummary();

  const handleMouseEnter = useCallback(() => {
    timerRef.current = setTimeout(async () => {
      setState((s) => ({ ...s, visible: true, loading: true }));
      try {
        const result = await fetchSummary({ url, title });
        setState({ visible: true, summary: result.summary, loading: false });
      } catch {
        setState({ visible: true, summary: null, loading: false });
      }
    }, 400);
  }, [url, title, fetchSummary]);

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState({ visible: false, summary: null, loading: false });
  }, []);

  return { ...state, handleMouseEnter, handleMouseLeave };
}
