import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSetting, setSetting } from '@/lib/localDb';

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  confirmOnDelete: boolean;
  syncEnabled: boolean;
  openTabOnClick: boolean;
  autoDedupOnMerge: boolean;
  staleThresholdDays: 7 | 14 | 30 | 60;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  confirmOnDelete: false,
  syncEnabled: true,
  openTabOnClick: true,
  autoDedupOnMerge: false,
  staleThresholdDays: 30
};

export const APP_SETTINGS_QUERY_KEY = ['appSettings'] as const;

/**
 * Reads the single 'appSettings' record from IndexedDB via TanStack Query.
 * staleTime:0 (like useGroups) so every subscriber always reflects the latest
 * saved value once the query is invalidated — this is what makes a Settings
 * save show up immediately in every other part of the popup without a reopen,
 * and what makes a post-login invalidation (see useSync) show correct values.
 */
export function useAppSettings() {
  return useQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: () => getSetting<AppSettings>('appSettings', DEFAULT_APP_SETTINGS),
    staleTime: 0,
    refetchOnWindowFocus: false
  });
}

/** Persists appSettings to IndexedDB and updates the shared cache so every subscriber re-renders immediately. */
export function useSaveAppSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: AppSettings) => {
      await setSetting('appSettings', next);
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(APP_SETTINGS_QUERY_KEY, next);
    }
  });
}
