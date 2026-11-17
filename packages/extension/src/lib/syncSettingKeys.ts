/** Setting: the user's preferences object (`AppSettings`, see hooks/useAppSettings.ts). Device-level, kept across accounts. */
export const APP_SETTINGS_KEY = 'appSettings';

/** Setting: the account whose groups are in this store (see `ensureAccountScope`). */
export const LAST_USER_ID_KEY = 'lastSignedInUserId';

/** Setting: true while a signed-in user with cloud sync is active; gates recording pending remote deletes. */
export const CLOUD_SYNC_ACTIVE_KEY = 'cloudSyncActive';

/**
 * Setting: `true` once every local session is on the server, encrypted under the CURRENT key.
 * Anything else means a full re-upload pass is due (`useSync`): `false` (written by a key change:
 * encryption setup, a reset, an unlock after the key was replaced elsewhere), a pass's own token
 * (a pass is running, or stopped before finishing), {@link REARMED_BY_BACKUP}. A single session's
 * change does not re-arm it: it carries its own `uploadPending` mark. Readers test `=== true`.
 */
export const SESSIONS_MIGRATION_DONE_KEY = 'sessionsEncryptionMigrationDone';

/**
 * Prefix of the token a running re-upload pass stores in {@link SESSIONS_MIGRATION_DONE_KEY}: a
 * fresh random value per pass (`pass:<random>`), so a pass only ever recognises ITS OWN marker.
 * When the pass ends it writes `true` only if its token is still stored, and its orphan cleanup
 * (remote deletes) runs only then too: another popup's pass, a key change, a backup run or a wipe
 * ("Clear all data", which removes the flag) in between all make it step back.
 */
export const SESSIONS_HEAL_PASS_PREFIX = 'pass:';

/**
 * The value of {@link SESSIONS_MIGRATION_DONE_KEY} between an automatic backup being written and
 * its upload ending, when the flag was `true` before. Not `true`, so a worker stopped mid-run leaves
 * a pass due; but a different value from `false` and from any pass token: when the run ends (the
 * backup uploaded, or its upload failed and the backup carries its own `uploadPending` mark for the
 * changed-sessions pass) it puts `true` back only if this exact value is still stored. So a backup
 * never costs a full re-upload pass by itself, and a `false` (a key change) or a pass token written
 * in between is never undone.
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

/**
 * Setting: `{ [sessionId]: deletedAtMs }`, sessions the user deleted on this device (written in the
 * same transaction as the local delete, see `deleteSession`). Shared by every popup and the worker:
 * an upload that started before the delete (in this context or another one) and re-created the row
 * deletes it again. Entries expire after {@link SESSION_DELETED_HERE_TTL_MS}; at most
 * {@link SESSION_DELETED_HERE_MAX} are kept. Account-scoped.
 */
export const SESSIONS_DELETED_HERE_KEY = 'sessionsDeletedHere';

/** How long a user-deleted session id is remembered: far longer than any upload request can take. */
export const SESSION_DELETED_HERE_TTL_MS = 60 * 60 * 1000;

/** At most this many remembered deleted session ids (the newest are kept). */
export const SESSION_DELETED_HERE_MAX = 500;

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
 * Setting: `{ id, at }`, the browser's download id of the last backup file that was written and
 * when (see lib/autoBackupFile.ts). Only this device's browser knows that id, so it is never
 * uploaded: like every key here it lives in the local settings store only. Account-scoped.
 */
export const AUTO_BACKUP_FILE_LAST_KEY = 'autoBackupFileLast';

/**
 * Auto-save open tabs: when the last scheduled run happened and how the last run ended (the
 * Settings status line). Shape checked by `parseAutoSaveState` (lib/autoSave.ts).
 */
export const AUTO_SAVE_STATE_KEY = 'autoSaveState';

/**
 * Auto-save open tabs: the plan last confirmed by the server for the signed-in account
 * (`{ tier, at }`). Only picks the on/off default, the alarm and the Free limits while the server
 * cannot be asked; a run never REMOVES anything on this remembered answer.
 */
export const AUTO_SAVE_TIER_SEEN_KEY = 'autoSaveTierSeen';

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
  AUTO_BACKUP_FILE_STATUS_KEY,
  AUTO_BACKUP_FILE_LAST_KEY,
  AUTO_SAVE_STATE_KEY,
  AUTO_SAVE_TIER_SEEN_KEY,
  SESSIONS_DELETED_HERE_KEY
] as const;
