/**
 * "Recently closed tabs": the background worker records the tabs and windows the user closes
 * (from `chrome.tabs` events, no extra permission) into a device-local IndexedDB store. What the
 * popup and the worker must agree on lives here; the per-plan limits are `RECENTLY_CLOSED_LIMITS`
 * in `./index.ts`, beside `FREE_TIER_LIMITS`.
 */

/** Runtime messages between the popup and the background worker. */
export const RECENTLY_CLOSED_MESSAGE = {
  /** Worker or popup → open extension pages: the recently-closed list changed, refetch it. */
  CHANGED: 'TM_RECENTLY_CLOSED_CHANGED',
  /** Popup → worker: entries were marked cleared, delete them after the undo window. */
  CLEARED: 'TM_RECENTLY_CLOSED_CLEARED',
} as const;

/** Shorthand for `RECENTLY_CLOSED_MESSAGE.CHANGED`. */
export const RECENTLY_CLOSED_CHANGED = RECENTLY_CLOSED_MESSAGE.CHANGED;

/**
 * `chrome.storage.session` keys. The quiet-close ids are `{ [tabId]: addedAtMs }`: tabs TabMerger
 * itself is about to close whose content is safe elsewhere, which the worker must not record.
 */
export const RECENTLY_CLOSED_STORAGE_KEYS = {
  quietCloseIds: 'tmQuietCloseIds',
  snapshots: 'tmClosedTabSnapshots',
} as const;

/** Debounce of the snapshot-cache mirror to `chrome.storage.session`. */
export const RECENTLY_CLOSED_SNAPSHOT_DEBOUNCE_MS = 500;

/** A quiet-close id older than this is ignored (and dropped): the close it announced never came. */
export const RECENTLY_CLOSED_QUIET_CLOSE_TTL_MS = 30 * 1000;

/** A window's buffered closes are written this long after the last one if `windows.onRemoved` never fires. */
export const RECENTLY_CLOSED_WINDOW_FLUSH_MS = 1000;

/** Entries marked cleared (Clear list, remove a day, turning it off) are deleted this long after the mark: the Undo window. */
export const RECENTLY_CLOSED_CLEAR_DELAY_MS = 10 * 1000;

/** On by default, also for existing users at the update. */
export const DEFAULT_REMEMBER_CLOSED_TABS = true;

/** Length caps for what is stored (page titles and URLs are untrusted input). */
export const RECENTLY_CLOSED_MAX_TITLE_LENGTH = 500;
export const RECENTLY_CLOSED_MAX_URL_LENGTH = 4096;
export const RECENTLY_CLOSED_MAX_FAVICON_LENGTH = 2048;
/** A window entry keeps at most this many tabs (a 2,000-tab window is not one entry's worth). */
export const RECENTLY_CLOSED_MAX_WINDOW_TABS = 500;
