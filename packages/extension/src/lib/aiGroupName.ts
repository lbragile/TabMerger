/** Longest AI-suggested group name kept; the prompts ask for a few words, so this only stops runaway output. */
export const MAX_AI_GROUP_NAME_LENGTH = 100;

/**
 * An AI provider's suggestion as a group name: a string, whitespace runs (newlines, tabs) collapsed
 * to one space, trimmed and capped. `null` when nothing usable is left. Every reply comes from an
 * AI provider, so it is untrusted input like any other (used by "Name group" and Organize renames).
 */
export function cleanSuggestedName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_AI_GROUP_NAME_LENGTH).trim();
  return name || null;
}
