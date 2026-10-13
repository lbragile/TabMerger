/** Setting: the user's preferences object (`AppSettings`, see hooks/useAppSettings.ts). Device-level, kept across accounts. */
export const APP_SETTINGS_KEY = 'appSettings';

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

/**
 * The value of {@link SESSIONS_MIGRATION_DONE_KEY} while a re-upload pass is running. It reads as
 * "not done" (falsy) to everyone, like `false`, but is a different value: when the pass ends it
 * only writes `true` if this marker is still stored. A `false` written meanwhile (a session
 * saved, a backup taken, encryption reset) is for a session the pass did not see, and stays.
 */
export const SESSIONS_HEAL_IN_PROGRESS = 0;

/**
 * The value of {@link SESSIONS_MIGRATION_DONE_KEY} between an automatic backup being written and
 * its upload being confirmed, when the flag was `true` before. Falsy like `false` (a worker
 * stopped mid-run leaves a backup the next sync uploads), but a different value from `false` and
 * from {@link SESSIONS_HEAL_IN_PROGRESS}: once the backup is on the server the run puts `true`
 * back only if this exact value is still stored. So a backup that uploaded does not cost a full
 * re-upload pass, and a `false` (a failed save, an encryption reset) or a pass marker written in
 * between is never undone. Every reader must test the flag for truthiness, never `=== false`.
 */
export const REARMED_BY_BACKUP = '';

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
 * Setting: when the last automatic backup was taken, the fingerprint of what it held and its session
 * id (see lib/autoBackup.ts). Account-scoped: the next account starts with "no backup yet".
 */
export const AUTO_BACKUP_STATE_KEY = 'autoBackupState';

/**
 * Setting: ids of automatic backups deleted on this device (rotated out, or deleted by the user)
 * whose server row is not confirmed gone yet. The delete is retried, and a backup download never
 * brings one of these back. Account-scoped.
 */
export const AUTO_BACKUP_PENDING_DELETES_KEY = 'autoBackupPendingRemoteDeletes';

/**
 * Setting: the user id a backup run or download claimed this store for. Every local write those
 * make is conditional on it (see `commitSessionsIfGuardHolds`). Account-scoped ON PURPOSE: the
 * account wipe (and "Clear all data") removes it, which is how an operation that started before
 * a wipe finds out and writes nothing into the wiped store.
 */
export const AUTO_BACKUP_STORE_GUARD_KEY = 'autoBackupStoreGuard';

/**
 * Setting: `{ userId, at }`, the last time the server answered that this account is NOT paid.
 * Scheduled backup checks skip the subscription request while it is fresh. Account-scoped.
 */
export const AUTO_BACKUP_FREE_SEEN_KEY = 'autoBackupFreeSeen';

/** Setting: `{ at, result, path }` of the last backup FILE write (see lib/autoBackupFile.ts). Account-scoped. */
export const AUTO_BACKUP_FILE_STATUS_KEY = 'autoBackupFileStatus';

/**
 * Settings that describe ONE account's sync progress. They live in the device-wide settings store,
 * so the account wipe removes them: the next account must not inherit "already migrated" /
 * "already seeded" from the previous one.
 */
export const ACCOUNT_SCOPED_SETTING_KEYS = [
  ENCRYPTION_MIGRATION_DONE_KEY,
  SESSIONS_MIGRATION_DONE_KEY,
  REMOTE_BASE_SEEDED_KEY,
  DELETE_BACKOFF_KEY,
  AUTO_BACKUP_STATE_KEY,
  AUTO_BACKUP_PENDING_DELETES_KEY,
  AUTO_BACKUP_STORE_GUARD_KEY,
  AUTO_BACKUP_FREE_SEEN_KEY,
  AUTO_BACKUP_FILE_STATUS_KEY
] as const;
