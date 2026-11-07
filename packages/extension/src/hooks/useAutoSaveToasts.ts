import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { GroupsState } from '@/lib/types';
import { onAutoSavePromoted } from '@/lib/autoSaveGroups';
import { toast } from '@/lib/toast';
import { t } from '@/lib/i18n';
import { useUIStore } from '@/stores/uiStore';
import { undoHistoryEntry } from '@/hooks/useUndoRedo';
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups';

/** `chrome.storage.local` flag: the one-time "Auto-save is on" toast was shown on this browser. */
export const AUTO_SAVE_INTRO_SHOWN_KEY = 'tmAutoSaveIntroShown';

/**
 * "Moved to your groups. It won't be removed automatically." with an Undo for the step that made it
 * (the Keep, or the edit that kept it). `before` is the top of the undo stack before that action:
 * when the action pushed no step of its own, there is nothing to offer.
 */
export function showAutoSaveKeptToast(qc: QueryClient, before?: GroupsState): void {
  const entry = useUIStore.getState().undoStack[0];
  const step = entry && entry !== before ? entry : undefined;
  toast.success(t('autoSave.toast.kept'), {
    id: 'auto-save-kept',
    ...(step
      ? {
          action: {
            label: t('header.undo'),
            onClick: () => {
              // only that step: a later change is never undone from this toast
              if (useUIStore.getState().undoStack[0] !== step) return;
              void undoHistoryEntry(qc, step);
            }
          }
        }
      : {})
  });
}

/**
 * The popup's half of "editing an auto-saved group keeps it": the write layer drops the marker
 * (lib/localDb.ts) and tells this context; here the user is told, and the cache is refreshed (a
 * drop writes the state it built itself, which still carries the marker).
 */
export function useAutoSavePromotionToast(): void {
  const qc = useQueryClient();
  useEffect(
    () =>
      onAutoSavePromoted(() => {
        // Called inside the write, BEFORE its own undo step is recorded: the top of the stack now
        // is what the toast's Undo must never take back.
        const before = useUIStore.getState().undoStack[0];
        // after the write's own step: the undo entry it pushes is recorded once the write returns
        setTimeout(() => {
          void qc.invalidateQueries({ queryKey: GROUPS_QUERY_KEY }, { cancelRefetch: false });
          showAutoSaveKeptToast(qc, before);
        }, 0);
      }),
    [qc]
  );
}

/**
 * "Auto-save is on. Change it in Settings → Data", once per browser, the first time an auto-save
 * exists (accounts that had Pro before the feature get it on by default and should hear about it).
 */
export function useAutoSaveIntroToast(hasAutoSaves: boolean): void {
  useEffect(() => {
    if (!hasAutoSaves || typeof chrome === 'undefined' || !chrome.storage?.local) return;
    let cancelled = false;
    void (async () => {
      try {
        const stored = await chrome.storage.local.get(AUTO_SAVE_INTRO_SHOWN_KEY);
        if (cancelled || stored[AUTO_SAVE_INTRO_SHOWN_KEY] === true) return;
        await chrome.storage.local.set({ [AUTO_SAVE_INTRO_SHOWN_KEY]: true });
        toast.info(t('autoSave.toast.intro'), { id: 'auto-save-intro' });
      } catch {
        // storage unavailable: no toast is better than one on every open
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasAutoSaves]);
}
