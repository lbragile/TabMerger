/**
 * Extension lifecycle state kept in `chrome.storage.local` for the daily `extension_heartbeat`
 * analytics event. The background worker writes most of it and the popup reads it, so both sides
 * use these names instead of repeating string literals.
 */

/** `chrome.alarms` name of the daily heartbeat. Must not start with the reminder prefix (`reminder-`). */
export const HEARTBEAT_ALARM_NAME = 'tm-heartbeat';

/** Epoch ms of the last heartbeat that was sent. */
export const HEARTBEAT_LAST_SENT_STORAGE_KEY = 'tm_last_heartbeat_at';

/** Epoch ms of the first install (`runtime.onInstalled` with reason `install`). Never set for older installs. */
export const INSTALLED_AT_STORAGE_KEY = 'tm_installed_at';

/**
 * The coarse plan the popup last saw (`free` / `pro` / `pro_ai` / `signed_out`), so the worker can
 * put it on the heartbeat without a network request. Missing until the popup has been opened.
 */
export const HEARTBEAT_TIER_STORAGE_KEY = 'tm_heartbeat_tier';

/** The coarse plan values the heartbeat may carry. */
export const HEARTBEAT_TIERS = ['free', 'pro', 'pro_ai', 'signed_out'] as const;
export type HeartbeatTier = (typeof HEARTBEAT_TIERS)[number];

/** At most one heartbeat per this many milliseconds (24 hours). */
export const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000;
