import { AI_NAME_GROUP_SUGGESTIONS } from '@tabmerger/shared';

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

/** Two group names are the same name when they match ignoring case (the server dedupes that way too). */
export function isSameGroupName(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

/**
 * The suggestions in a `/api/ai/name-group` reply, ready to offer: `names` when it is a non-empty
 * array, else `name` when that is an array (a stale or in-between server put the list there), else
 * `[name]` (an older server sends only one `name`). Each is cleaned with
 * `cleanSuggestedName`; unusable ones and repeats (ignoring case) are dropped, and at most
 * `AI_NAME_GROUP_SUGGESTIONS` are kept, best first. The server already does most of this: the
 * reply is provider output passed through, so the client checks it again.
 */
export function suggestedGroupNames(reply: unknown): string[] {
  const body = reply && typeof reply === 'object' ? (reply as { names?: unknown; name?: unknown }) : {};
  const raw: unknown[] =
    Array.isArray(body.names) && body.names.length > 0 ? body.names : Array.isArray(body.name) ? body.name : [body.name];
  const names: string[] = [];
  for (const item of raw) {
    const name = cleanSuggestedName(item);
    if (name && !names.some((n) => isSameGroupName(n, name))) names.push(name);
    if (names.length === AI_NAME_GROUP_SUGGESTIONS) break;
  }
  return names;
}
