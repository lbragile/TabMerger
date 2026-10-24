import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, X } from 'lucide-react';
import { useSuggestSessions } from '@/hooks/useAI';
import { QuotaExceededError } from '@/lib/aiErrors';
import { useGroups, useArchiveGroups, useMergeGroups } from '@/hooks/useGroups';
import { useEntitlements } from '@/hooks/useEntitlements';
import { AIQuotaExceededPrompt } from '@/components/AIQuotaExceededPrompt';
import { useUIStore } from '@/stores/uiStore';
import { getSetting } from '@/lib/localDb';
import { AI_ENABLED } from '@/lib/aiFlag';
import { isAiSuggestionKind, type AiSuggestionKind } from '@tabmerger/shared';

const STORAGE_KEY = 'tm_ai_suggestion';

/** `kind` is missing only from a suggestion stored before the Merge action existed (see the mount read). */
type Stored = { message: string; staleGroupIds: string[]; kind?: AiSuggestionKind; dismissed: boolean } | null;

export function AIGroupSuggestion() {
  const { t } = useTranslation();
  // Start fully hidden until chrome.storage read completes — prevents any flash
  const [stored, setStored] = useState<Stored>(null);
  const [storageReady, setStorageReady] = useState(false);
  const fired = useRef(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const { aiFeatures, loading } = useEntitlements();
  const { data: groupsState } = useGroups();
  const { mutateAsync: suggest } = useSuggestSessions();
  const { mutateAsync: archiveGroups } = useArchiveGroups();
  const { mutateAsync: mergeGroups } = useMergeGroups();
  const openModal = useUIStore((s) => s.openModal);

  // Read persisted state once on mount
  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const saved = (result[STORAGE_KEY] as Stored) ?? null;
      // Saved before `kind` existed: its message may propose a merge ("Merge them?") that the
      // banner would offer as Archive. Drop it so a fresh suggestion is fetched.
      const legacy = Boolean(saved?.message) && !saved?.dismissed && !isAiSuggestionKind(saved?.kind);
      if (legacy) chrome.storage.local.remove(STORAGE_KEY);
      setStored(legacy ? null : saved);
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
        const kind = isAiSuggestionKind(res.kind) ? res.kind : 'archive';
        const next: Stored = { message: res.message, staleGroupIds: res.staleGroupIds, kind, dismissed: false };
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
    // ONE write and one undo step for all of them (an Undo brings every one of them back)
    const present = groupIds.filter((id) => groupsState?.available.some((g) => g.id === id));
    if (present.length > 0) await archiveGroups(present);
    const remainingIds = (stored?.staleGroupIds ?? []).filter((id) => !groupIds.includes(id));
    if (remainingIds.length === 0) {
      dismiss();
      return;
    }
    const next: Stored = { message: stored?.message ?? '', staleGroupIds: remainingIds, kind: stored?.kind, dismissed: false };
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

  /** Merges every listed group into the first one (one undo step), then retires the suggestion. */
  const mergeAll = async () => {
    await mergeGroups(staleGroups.map((g) => g.id));
    dismiss();
  };

  const staleGroups = (stored?.staleGroupIds ?? [])
    .map((id) => groupsState?.available.find((g) => g.id === id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g));
  const isMerge = stored?.kind === 'merge';
  // A merge needs two groups; an archive needs one.
  const actionable = staleGroups.length >= (isMerge ? 2 : 1);

  // The groups were deleted or archived since the suggestion was generated: nothing actionable left, auto-dismiss.
  useEffect(() => {
    if (storageReady && stored?.message && !stored.dismissed && stored.staleGroupIds.length > 0 && !actionable) {
      dismiss();
    }
   
  }, [storageReady, stored, actionable]);

  // AI features: coming soon — fully hidden while the global flag is off.
  if (!AI_ENABLED || !storageReady || loading || !aiFeatures || stored?.dismissed) return null;

  if (quotaExceeded) {
    return (
      <div className="border-b border-purple-200 dark:border-purple-800">
        <AIQuotaExceededPrompt />
      </div>
    );
  }

  if (!stored?.message || !actionable) return null;

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
        {t('banners.review')}
      </button>
      <button
        className="shrink-0 border border-purple-400 text-purple-700 dark:text-purple-300 px-2 py-0.5 text-xs hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
        onClick={isMerge ? mergeAll : archiveAll}
      >
        {isMerge ? t('banners.merge') : t('banners.archive')}
      </button>
      <button
        className="shrink-0 text-purple-500 hover:opacity-70 transition-opacity ms-1"
        onClick={dismiss}
        aria-label={t('banners.dismiss')}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
