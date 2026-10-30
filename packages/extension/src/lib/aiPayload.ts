import { AI_MAX_GROUP_NAME_LENGTH, AI_MAX_TITLE_LENGTH, AI_MAX_URL_LENGTH } from '@tabmerger/shared';

/**
 * The tab data an `/api/ai/*` request carries, cut to what the server keeps. The routes read only
 * each tab's title and URL (plus the id for group-tabs) and truncate them to the shared
 * `AI_MAX_*_LENGTH` limits; their raw request bodies are capped too (64 KB for one tab, 1 MB for a
 * tab list, 2 MB for groups). Sending whole tabs, or a `data:` URL or icon that runs to megabytes,
 * could get an otherwise valid request refused as too large, so the extension cuts first.
 */

/** A tab as the AI routes read it. */
export interface AiPromptTab {
  title: string;
  url: string;
}

/**
 * `value` cut to at most `max` UTF-16 code units, or `''` when it isn't a string. A cut that would
 * split a surrogate pair drops the pair's first half, so no lone surrogate is sent.
 */
export function cutText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * A URL cut to `max`, without sending more of it than the server would keep:
 * - the `#fragment` goes first (the server drops it anyway), so the cut keeps more of the path;
 * - a query parameter the cut lands inside is dropped whole. The server strips secret-looking
 *   parameters by name and JWT-shaped values, and a value cut in half (half a JWT) could slip
 *   past that check, so a partial parameter is never sent.
 * A URL within `max` is sent as is: the server does all of its own cleaning.
 */
export function cutUrl(value: unknown, max: number = AI_MAX_URL_LENGTH): string {
  if (typeof value !== 'string') return '';
  if (value.length <= max) return value;
  const hash = value.indexOf('#');
  const noFragment = hash >= 0 ? value.slice(0, hash) : value;
  if (noFragment.length <= max) return noFragment;

  const cut = cutText(noFragment, max);
  const query = cut.indexOf('?');
  if (query < 0) return cut;
  // The cut ends inside the query: drop the parameter it split, and a `?` or `&` left trailing
  const lastSeparator = Math.max(cut.lastIndexOf('&'), query);
  return cut.slice(0, lastSeparator).replace(/[?&]+$/, '');
}

/** A tab's title and URL, cut to the server's lengths. Every other field (icon, id, ...) is left out. */
export function aiPromptTab(tab: { title?: unknown; url?: unknown }): AiPromptTab {
  return { title: cutText(tab.title, AI_MAX_TITLE_LENGTH), url: cutUrl(tab.url) };
}

/**
 * A tab of a group list (suggest-sessions, organize). Those routes read tabs tolerantly and drop
 * one without a string URL, so such a tab is sent without `url` (and dropped there as before)
 * instead of as an empty URL the server would keep.
 */
export function aiGroupListTab(tab: { title?: unknown; url?: unknown }): AiPromptTab | { title: string } {
  return typeof tab.url === 'string' ? aiPromptTab(tab) : { title: cutText(tab.title, AI_MAX_TITLE_LENGTH) };
}

/** {@link aiPromptTab} plus the tab's id, for the group-tabs route (its answer lists tab ids). */
export function aiIdentifiedTab(tab: { id: number; title?: unknown; url?: unknown }): AiPromptTab & { id: number } {
  return { id: tab.id, ...aiPromptTab(tab) };
}

/** A group name cut to the server's length. */
export function aiPromptGroupName(name: unknown): string {
  return cutText(name, AI_MAX_GROUP_NAME_LENGTH);
}
