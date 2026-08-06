import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

/** Persists the full draft array in one write — used by UrlRulesModal's top-level Save. */
export function useSaveUrlRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rules: UrlRule[]) => {
      await persistRules(rules);
      return rules;
    },
    onSuccess: (rules) => {
      qc.setQueryData(URL_RULES_KEY, rules);
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
