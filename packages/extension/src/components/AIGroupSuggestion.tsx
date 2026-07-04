import { useState, useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSuggestSessions } from '@/hooks/useAI';
import { useGroups } from '@/hooks/useGroups';
import { useEntitlements } from '@/hooks/useEntitlements';

export function AIGroupSuggestion() {
  const [dismissed, setDismissed] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const { aiFeatures } = useEntitlements();
  const { data: groupsState } = useGroups();
  const { mutateAsync: suggest } = useSuggestSessions();

  useEffect(() => {
    if (!aiFeatures || !groupsState || dismissed) return;

    const recentGroups = groupsState.available.slice(0, 5);
    suggest(recentGroups)
      .then((res) => setSuggestion(res.suggestion))
      .catch(() => {});
  }, [aiFeatures, groupsState, dismissed, suggest]);

  if (!aiFeatures || !suggestion || dismissed) return null;

  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-purple-50 dark:bg-purple-950/20 border-b border-purple-200 dark:border-purple-800 text-xs">
      <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0 mt-0.5" />
      <p className="flex-1 text-purple-700 dark:text-purple-300">{suggestion}</p>
      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4 shrink-0 text-purple-500 hover:text-purple-700"
        onClick={() => setDismissed(true)}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
