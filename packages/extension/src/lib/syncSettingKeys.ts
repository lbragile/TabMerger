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
