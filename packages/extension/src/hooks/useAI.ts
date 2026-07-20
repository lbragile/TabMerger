import { useMutation } from '@tanstack/react-query';
import { trackEvent } from '@/lib/analytics';
import type { Tab, Group } from '@/lib/types';
import { useAuth } from './useAuth';
import { useEntitlements } from './useEntitlements';

const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL as string;

async function aiPost<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${WEB_APP_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI request failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<T>;
}

export function useAutoGroup() {
  const { session } = useAuth();
  const { aiFeatures } = useEntitlements();

  return useMutation({
    onSuccess: () => { trackEvent('ai_feature_used', { feature_name: 'group' }); },
    mutationFn: async (tabs: Tab[]) => {
      if (!aiFeatures) throw new Error('Pro AI plan required');
      if (!session?.access_token) throw new Error('Not authenticated');

      return aiPost<{ groups: { name: string; color: string; tabIds: number[] }[] }>(
        '/api/ai/group-tabs',
        { tabs },
        session.access_token
      );
    }
  });
}

export function useNameGroup() {
  const { session } = useAuth();
  const { aiFeatures } = useEntitlements();

  return useMutation({
    onSuccess: () => { trackEvent('ai_feature_used', { feature_name: 'name' }); },
    mutationFn: async (tabs: Tab[]) => {
      if (!aiFeatures) throw new Error('Pro AI plan required');
      if (!session?.access_token) throw new Error('Not authenticated');

      return aiPost<{ name: string }>('/api/ai/name-group', { tabs }, session.access_token);
    }
  });
}

export function useSuggestSessions() {
  const { session } = useAuth();
  const { aiFeatures } = useEntitlements();

  return useMutation({
    onSuccess: () => { trackEvent('ai_feature_used', { feature_name: 'suggest' }); },
    mutationFn: async (recentGroups: Group[]) => {
      if (!aiFeatures) throw new Error('Pro AI plan required');
      if (!session?.access_token) throw new Error('Not authenticated');

      return aiPost<{ suggestion: string }>(
        '/api/ai/suggest-sessions',
        { recentGroups },
        session.access_token
      );
    }
  });
}

export function useOrganizeTabs() {
  const { session } = useAuth();
  const { aiFeatures } = useEntitlements();

  return useMutation({
    onSuccess: () => { trackEvent('ai_feature_used', { feature_name: 'organize' }); },
    mutationFn: async () => {
      if (!aiFeatures) throw new Error('Pro AI plan required');
      if (!session?.access_token) throw new Error('Not authenticated');

      return aiPost<{ runId: string; token: string }>(
        '/api/ai/organize',
        {}, // ponytail: no body — server derives userId from Bearer token
        session.access_token
      );
    }
  });
}

export function useTabSummary() {
  const { session } = useAuth();
  const { aiFeatures } = useEntitlements();

  return useMutation({
    mutationFn: async ({ url, title }: { url: string; title: string }) => {
      if (!aiFeatures || !session?.access_token) return { summary: null };

      return aiPost<{ summary: string }>(
        '/api/ai/tab-summary',
        { url, title },
        session.access_token
      );
    }
  });
}
