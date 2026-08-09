// Dev-only local stand-in for the real `ai_usage` Supabase table, so the AI quota UI
// (AIQuotaExceededPrompt) can be exercised in local dev without a real backend/month wait.
const STORAGE_KEY = 'tm_dev_ai_usage_count';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

interface DevAiUsage {
  month: string;
  count: number;
}

export async function getDevAiUsage(): Promise<number> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as DevAiUsage | undefined;
  if (!stored || stored.month !== currentMonth()) return 0;
  return stored.count;
}

export async function incrementDevAiUsage(): Promise<void> {
  const count = (await getDevAiUsage()) + 1;
  await chrome.storage.local.set({ [STORAGE_KEY]: { month: currentMonth(), count } satisfies DevAiUsage });
}

export async function setDevAiUsage(count: number): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: { month: currentMonth(), count } satisfies DevAiUsage });
}
