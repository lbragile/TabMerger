import { useState, useEffect, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useSuggestSessions, QuotaExceededError } from '@/hooks/useAI';
import { useGroups, useArchiveGroup } from '@/hooks/useGroups';
import { useEntitlements } from '@/hooks/useEntitlements';
import { AIQuotaExceededPrompt } from '@/components/AIQuotaExceededPrompt';
import { useUIStore } from '@/stores/uiStore';
import { getSetting } from '@/lib/localDb';

const STORAGE_KEY = 'tm_ai_suggestion';

type Stored = { message: string; staleGroupIds: string[]; dismissed: boolean } | null;

export function AIGroupSuggestion() {
  // Start fully hidden until chrome.storage read completes — prevents any flash
  const [stored, setStored] = useState<Stored>(null);
  const [storageReady, setStorageReady] = useState(false);
  const fired = useRef(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const { aiFeatures, loading } = useEntitlements();
  const { data: groupsState } = useGroups();
  const { mutateAsync: suggest } = useSuggestSessions();
  const { mutateAsync: archiveGroup } = useArchiveGroup();
  const openModal = useUIStore((s) => s.openModal);

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
    if (stored?.message || stored?.dismissed) return;
    fired.current = true;
    const recentGroups = groupsState.available.slice(0, 5);
    suggest(recentGroups)
      .then((res) => {
        if (!res.message || res.staleGroupIds.length === 0) return;
        const next: Stored = { message: res.message, staleGroupIds: res.staleGroupIds, dismissed: false };
        setStored(next);
        chrome.storage.local.set({ [STORAGE_KEY]: next });
      })
      // ponytail: no separate "attempted" marker needed on failure/empty result —
      // useSuggestSessions marks the day as used before the network call runs
      // (see enforceDailyThrottle in useAI.ts), so a retry on the next popup open
      // this same day short-circuits with "Already used today" instead of re-firing.
      // Quota-exceeded is the one failure worth surfacing: since this fires
      // automatically (not a user click), show the buy-more CTA in place of the
      // suggestion banner rather than let the feature silently never work again
      // for the rest of the month.
      .catch((err) => {
        if (err instanceof QuotaExceededError) setQuotaExceeded(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageReady, loading, aiFeatures]);

  const dismiss = () => {
    const next: Stored = { message: '', staleGroupIds: [], dismissed: true };
    setStored(next);
    chrome.storage.local.set({ [STORAGE_KEY]: next });
  };

  /** Archives one or more stale groups (single-click Archive uses [groupId], the header
   * "Archive all" button passes every listed stale group id at once) and updates the
   * persisted suggestion to drop whichever ids got archived. */
  const handleArchive = async (groupIds: string[]) => {
    for (const groupId of groupIds) {
      const groupIndex = groupsState?.available.findIndex((g) => g.id === groupId) ?? -1;
      if (groupIndex === -1) continue;
      await archiveGroup(groupIndex);
    }
    const remainingIds = (stored?.staleGroupIds ?? []).filter((id) => !groupIds.includes(id));
    if (remainingIds.length === 0) {
      dismiss();
      return;
    }
    const next: Stored = { message: stored?.message ?? '', staleGroupIds: remainingIds, dismissed: false };
    setStored(next);
    chrome.storage.local.set({ [STORAGE_KEY]: next });
  };

  /** Bulk-archives every listed stale group, gated behind the confirmOnDelete setting
   * just like CleanupSuggestionBanner's "Remove stale" — a destructive bulk action
   * should ask first if the user has opted into confirmations. */
  const archiveAll = async () => {
    const ids = staleGroups.map((g) => g.id);
    const { confirmOnDelete } = await getSetting('appSettings', { confirmOnDelete: false });
    if (confirmOnDelete) {
      openModal('archiveStaleGroups', { count: ids.length, onConfirm: () => handleArchive(ids) });
    } else {
      await handleArchive(ids);
    }
  };

  const staleGroups = (stored?.staleGroupIds ?? [])
    .map((id) => groupsState?.available.find((g) => g.id === id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g));

  // All stale groups were deleted since the suggestion was generated — nothing actionable left, auto-dismiss.
  useEffect(() => {
    if (storageReady && stored?.message && !stored.dismissed && stored.staleGroupIds.length > 0 && staleGroups.length === 0) {
      dismiss();
    }
   
  }, [storageReady, stored, staleGroups.length]);

  if (!storageReady || loading || !aiFeatures || stored?.dismissed) return null;

  if (quotaExceeded) {
    return (
      <div className="border-b border-purple-200 dark:border-purple-800">
        <AIQuotaExceededPrompt />
      </div>
    );
  }

  if (!stored?.message || staleGroups.length === 0) return null;

  return (
    <div
      className="flex items-center gap-2 px-3 text-xs shrink-0 bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-300 border-b border-purple-200 dark:border-purple-800"
      style={{ height: 38 }}
    >
      <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" />
      <span className="flex-1 truncate">{stored.message}</span>
      <button
        className="shrink-0 border border-purple-400 text-purple-700 dark:text-purple-300 px-2 py-0.5 text-xs hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
        onClick={() =>
          openModal('reviewStaleGroup', { groups: staleGroups, onArchive: (groupId: string) => handleArchive([groupId]) })
        }
      >
        Review
      </button>
      <button
        className="shrink-0 border border-purple-400 text-purple-700 dark:text-purple-300 px-2 py-0.5 text-xs hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
        onClick={archiveAll}
      >
        Archive
      </button>
      <button
        className="shrink-0 text-purple-500 hover:opacity-70 transition-opacity ml-1"
        onClick={dismiss}
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
