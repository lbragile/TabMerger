import { useEffect, useState } from 'react';
import { useGroups } from '@/hooks/useGroups';
import { getSetting } from '@/lib/localDb';
import type { Tab } from '@/lib/types';

const MIN_STALE = 5;

/**
 * Client-side heuristic for cleanup suggestions.
 * Stale = tab's `savedAt` older than the configured threshold (default 30 days).
 * Only surfaces suggestions when ≥ MIN_STALE stale tabs exist across saved groups
 * (Now Open / index 0 is excluded — its tabs have no savedAt).
 */
export function useCleanupSuggestions() {
  const { data: groupsState } = useGroups();
  const [thresholdDays, setThresholdDays] = useState(30);

  useEffect(() => {
    getSetting<{ staleThresholdDays?: number }>('appSettings', {}).then((s) =>
      setThresholdDays(s.staleThresholdDays ?? 30)
    );
  }, []);

  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const staleTabs: Tab[] = [];
  const staleGroupIndexes = new Set<number>();

  if (groupsState) {
    groupsState.available.forEach((g, gi) => {
      if (g.permanent) return; // skip Now Open
      for (const w of g.windows) {
        for (const t of w.tabs) {
          if (t.savedAt && now - t.savedAt > thresholdMs) {
            staleTabs.push(t);
            staleGroupIndexes.add(gi);
          }
        }
      }
    });
  }

  const hasEnough = staleTabs.length >= MIN_STALE;

  return {
    staleTabs: hasEnough ? staleTabs : [],
    staleGroupIndexes: hasEnough ? [...staleGroupIndexes] : [],
    staleThresholdDays: thresholdDays,
    thresholdMs
  };
}
