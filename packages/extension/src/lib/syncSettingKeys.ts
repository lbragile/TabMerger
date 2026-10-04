/** Setting: the account whose groups are in this store (see `ensureAccountScope`). */
export const LAST_USER_ID_KEY = 'lastSignedInUserId';

/** Setting: true while a signed-in user with cloud sync is active; gates recording pending remote deletes. */
export const CLOUD_SYNC_ACTIVE_KEY = 'cloudSyncActive';

/**
 * Setting: true once EVERY locally saved session is on the server, encrypted. Sessions have no
 * per-row pending flag, so this one flag is their "nothing left to upload" marker: it is re-armed
 * (false) whenever a session upload was skipped or failed, and by encryption setup / reset, and
 * `useSync` re-uploads all sessions until every push succeeded.
 */
export const SESSIONS_MIGRATION_DONE_KEY = 'sessionsEncryptionMigrationDone';

/** Setting: the one-time "mark every group for an encrypted re-upload" self-heal ran (see useSync). */
export const ENCRYPTION_MIGRATION_DONE_KEY = 'encryptionMigrationDone';

/**
 * Setting: true once the first sync after the base-stamp upgrade has run. Until then a pending
 * group without a `remoteUpdatedAt` may be an OLD (pre-upgrade) group whose row exists remotely:
 * it adopts the row's current stamp as its base instead of being treated as a conflict. Afterwards,
 * no base + a row that exists remotely is a genuine id collision.
 */
export const REMOTE_BASE_SEEDED_KEY = 'remoteBaseSeeded';

/** Setting: retry backoff of the pending remote deletes (see syncEngine's flushPendingDeletes). */
export const DELETE_BACKOFF_KEY = 'pendingDeleteBackoff';

/**
 * Settings that describe ONE account's sync progress. They live in the device-wide settings store,
 * so the account wipe removes them: the next account must not inherit "already migrated" /
 * "already seeded" from the previous one.
 */
export const ACCOUNT_SCOPED_SETTING_KEYS = [
  ENCRYPTION_MIGRATION_DONE_KEY,
  SESSIONS_MIGRATION_DONE_KEY,
  REMOTE_BASE_SEEDED_KEY,
  DELETE_BACKOFF_KEY
] as const;
