import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nanoid } from 'nanoid';
import { getSetting, setSetting } from '@/lib/localDb';
import type { UrlRule } from '@/lib/types';

const URL_RULES_KEY = ['urlRules'] as const;

async function loadRules(): Promise<UrlRule[]> {
  return getSetting<UrlRule[]>('urlRules', []);
}

async function persistRules(rules: UrlRule[]): Promise<void> {
  await setSetting('urlRules', rules);
}

export function useUrlRules() {
  return useQuery({ queryKey: URL_RULES_KEY, queryFn: loadRules, staleTime: Infinity });
}

export function useAddUrlRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pattern, groupId }: { pattern: string; groupId: string }) => {
      const prev = qc.getQueryData<UrlRule[]>(URL_RULES_KEY) ?? await loadRules();
      const next = [...prev, { id: nanoid(10), pattern, groupId, createdAt: Date.now() }];
      await persistRules(next);
      qc.setQueryData(URL_RULES_KEY, next);
    }
  });
}

export function useDeleteUrlRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const prev = qc.getQueryData<UrlRule[]>(URL_RULES_KEY) ?? await loadRules();
      const next = prev.filter((r) => r.id !== id);
      await persistRules(next);
      qc.setQueryData(URL_RULES_KEY, next);
    }
  });
}

export function useReorderUrlRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ from, to }: { from: number; to: number }) => {
      const prev = qc.getQueryData<UrlRule[]>(URL_RULES_KEY) ?? await loadRules();
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      await persistRules(next);
      qc.setQueryData(URL_RULES_KEY, next);
    }
  });
}

/** Returns the groupId for the first matching rule, or null if none match. */
export function matchUrlToRule(url: string, rules: UrlRule[]): string | null {
  for (const rule of rules) {
    // ponytail: simple glob — only * wildcard, no ** or ? needed for domain patterns
    const escaped = rule.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    try {
      /** strip scheme so patterns like "github.com/*" work without requiring "https://" */
      if (new RegExp(`^${escaped}$`).test(url.replace(/^https?:\/\//, ''))) {
        return rule.groupId;
      }
    } catch {
      // malformed pattern — skip
    }
  }
  return null;
}
