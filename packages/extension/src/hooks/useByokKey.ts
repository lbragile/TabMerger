import { useQuery, useQueryClient } from '@tanstack/react-query';
import { maskApiKey, type AiProvider } from '@tabmerger/shared';
import { getByokKey } from '@/lib/byokKey';
import { useAuth } from './useAuth';

/** The saved own key as Settings shows it: masked, with its provider. */
export interface SavedByokKeyInfo {
  masked: string;
  provider: AiProvider;
}

const byokKeyQueryKey = (userId: string | undefined) => ['aiByokKey', userId] as const;

/**
 * The signed-in user's saved own key (lib/byokKey.ts), masked, and its provider; `null` when none
 * is saved. Only the masked form enters the query cache, never the key. `refresh` re-reads it
 * after a save or removal.
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
  return {
    saved: data ?? null,
    loading: !!userId && isLoading,
    refresh: () => queryClient.invalidateQueries({ queryKey: byokKeyQueryKey(userId) })
  };
}
