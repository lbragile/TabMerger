/**
 * Query keys of the automatic-backups panel, in their own dependency-free module so any component
 * can read or refresh a cached result without importing the code behind it.
 */

/** The "backups stored in the account" download (see lib/autoBackupDownload.ts), per signed-in user. */
export const autoBackupDownloadQueryKey = (userId: string | undefined) => ['autoBackupDownload', userId ?? null] as const;

/** Whether the browser currently lets the extension save files (the optional `downloads` permission). */
export const backupFilePermissionQueryKey = ['backupFilePermission'] as const;

/** What the last backup file write did (see lib/autoBackupFile.ts). */
export const backupFileStatusQueryKey = ['backupFileStatus'] as const;
