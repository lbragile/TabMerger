import { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCleanupSuggestions } from '@/hooks/useCleanupSuggestions';
import { useRemoveStaleTabs } from '@/hooks/useGroups';
import { useUIStore } from '@/stores/uiStore';

const DISMISSED_KEY = 'cleanup_banner_dismissed_until';

function isDismissed() {
  const until = Number(localStorage.getItem(DISMISSED_KEY) ?? 0);
  return Date.now() < until;
}

export function CleanupSuggestionBanner() {
  const [dismissed, setDismissed] = useState(isDismissed);
  const { staleTabs, staleGroupIndexes, staleThresholdDays, thresholdMs } = useCleanupSuggestions();
  const { mutateAsync: removeStaleTabs } = useRemoveStaleTabs();
  const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex);

  if (dismissed || staleTabs.length < 5) return null;

  const count = staleTabs.length;

  function dismiss() {
    // Re-appears after 7 days
    localStorage.setItem(DISMISSED_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
    setDismissed(true);
  }

  function review() {
    // Jump to the first group holding stale tabs so the user can eyeball them
    if (staleGroupIndexes.length > 0) setActiveGroupIndex(staleGroupIndexes[0]);
  }

  async function removeAll() {
    for (const groupIndex of staleGroupIndexes) {
      await removeStaleTabs({ groupIndex, staleThresholdMs: thresholdMs });
    }
    toast.success(`Removed ${count} stale ${count === 1 ? 'tab' : 'tabs'}`);
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 text-amber-800 text-xs dark:bg-amber-950 dark:text-amber-300">
      <Trash2 className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">
        You have {count} tabs saved over {staleThresholdDays} days ago. Remove stale tabs?
      </span>
      <button
        className="font-semibold underline underline-offset-2 hover:no-underline shrink-0"
        onClick={review}
      >
        Review
      </button>
      <button
        className="font-semibold underline underline-offset-2 hover:no-underline shrink-0"
        onClick={removeAll}
      >
        Remove stale
      </button>
      <button className="ml-1 hover:opacity-70 shrink-0" onClick={dismiss} aria-label="Dismiss">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
