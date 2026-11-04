import { useQuery, useQueryClient } from '@tanstack/react-query';
import { maskApiKey, type AiProvider } from '@tabmerger/shared';
import { getByokKey, getPickedByokProvider, setPickedByokProvider } from '@/lib/byokKey';
import { useAuth } from './useAuth';

/** The saved own key as Settings shows it: masked, with its provider. */
export interface SavedByokKeyInfo {
  masked: string;
  provider: AiProvider;
}

const byokKeyQueryKey = (userId: string | undefined) => ['aiByokKey', userId] as const;
const pickedProviderQueryKey = (userId: string | undefined) => ['aiByokProvider', userId] as const;

/**
 * The signed-in user's saved own key (lib/byokKey.ts), masked, and its provider; `null` when none
 * is saved. Only the masked form enters the query cache, never the key. `refresh` re-reads it
 * after a save or removal.
 *
 * Also the provider picked in Settings without a key for it yet (`picked`, kept on this device),
 * and `pick` to change it: null forgets the pick, which means "the saved key's provider".
 */
export function useByokKey() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: byokKeyQueryKey(userId),
    queryFn: async (): Promise<SavedByokKeyInfo | null> => {
      const saved = await getByokKey(userId);
      return saved ? { masked: maskApiKey(saved.key), provider: saved.provider } : null;
    },
    enabled: !!userId
  });
  const picked = useQuery({
    queryKey: pickedProviderQueryKey(userId),
    queryFn: () => getPickedByokProvider(userId),
    enabled: !!userId
  });
  return {
    saved: data ?? null,
    picked: picked.data ?? null,
    loading: !!userId && (isLoading || picked.isLoading),
    refresh: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: byokKeyQueryKey(userId) }),
        queryClient.invalidateQueries({ queryKey: pickedProviderQueryKey(userId) })
      ]),
    /** Shows `provider` at once and remembers it for this device; null forgets the pick. */
    pick: async (provider: AiProvider | null) => {
      if (!userId) return;
      queryClient.setQueryData(pickedProviderQueryKey(userId), provider);
      await setPickedByokProvider(userId, provider);
    }
  };
}
