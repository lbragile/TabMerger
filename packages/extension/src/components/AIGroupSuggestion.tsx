import { useState, useEffect, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSuggestSessions } from '@/hooks/useAI';
import { useGroups } from '@/hooks/useGroups';
import { useEntitlements } from '@/hooks/useEntitlements';

const STORAGE_KEY = 'tm_ai_suggestion';

type Stored = { suggestion: string; dismissed: boolean } | null;

export function AIGroupSuggestion() {
  // Start fully hidden until chrome.storage read completes — prevents any flash
  const [stored, setStored] = useState<Stored>(null);
  const [storageReady, setStorageReady] = useState(false);
  const fired = useRef(false);
  const { aiFeatures, loading } = useEntitlements();
  const { data: groupsState } = useGroups();
  const { mutateAsync: suggest } = useSuggestSessions();

  // Read persisted state once on mount
  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      setStored((result[STORAGE_KEY] as Stored) ?? null);
      setStorageReady(true);
    });
  }, []);

  // Fetch suggestion once per install/clear cycle
  useEffect(() => {
    if (!storageReady || loading || !aiFeatures || !groupsState || fired.current) return;
    if (stored?.suggestion || stored?.dismissed) return;
    fired.current = true;
    const recentGroups = groupsState.available.slice(0, 5);
    suggest(recentGroups)
      .then((res) => {
        const text = res.suggestion;
        if (!text) return;
        const next: Stored = { suggestion: text, dismissed: false };
        setStored(next);
        chrome.storage.local.set({ [STORAGE_KEY]: next });
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageReady, loading, aiFeatures]);

  const handleDismiss = () => {
    const next: Stored = { suggestion: stored?.suggestion ?? '', dismissed: true };
    setStored(next);
    chrome.storage.local.set({ [STORAGE_KEY]: next });
  };

  if (!storageReady || loading || !aiFeatures || !stored?.suggestion || stored.dismissed) return null;

  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-purple-50 dark:bg-purple-950/20 border-b border-purple-200 dark:border-purple-800 text-xs">
      <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0 mt-0.5" />
      <p className="flex-1 text-purple-700 dark:text-purple-300">{stored.suggestion}</p>
      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4 shrink-0 text-purple-500 hover:text-purple-700"
        onClick={handleDismiss}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
