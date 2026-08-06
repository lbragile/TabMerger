// Shared per-action daily throttle for AI mutations. Server-side quota is monthly
// (AI_MONTHLY_CAP), so a client-side once-a-day guard prevents a UI bug from
// burning the whole month's budget in a single day (see AIGroupSuggestion re-fire incident).
const dayKey = () => Math.floor(Date.now() / 86_400_000); // epoch day, UTC — good enough, no need for local-tz precision

function storageKey(action: string) {
  return `ai_last_call_${action}`;
}

export async function wasCalledToday(action: string): Promise<boolean> {
  const key = storageKey(action);
  const result = await chrome.storage.local.get(key);
  return result[key] === dayKey();
}

export async function markCalledToday(action: string): Promise<void> {
  await chrome.storage.local.set({ [storageKey(action)]: dayKey() });
}
