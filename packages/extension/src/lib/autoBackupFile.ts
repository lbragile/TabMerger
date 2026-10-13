import { BACKUP_FILE_PERMISSION, buildBackupFilePath, withoutLocalOnlySyncKeys } from '@tabmerger/shared';
import type { Group, Session } from '@/lib/types';
import { exportGroups } from '@/lib/importExport';
import { getGroupTabCount } from '@/lib/utils';

/**
 * "Also save a file to this computer": writes a backup as a JSON file inside the browser's
 * Downloads folder through `chrome.downloads` (an OPTIONAL permission the user grants when they
 * turn the option on). Runs in the background worker as part of a backup run. No React here.
 *
 * The file is the same JSON the Settings "Export" button produces (an array of groups), so
 * "Import" reads it back. It is plaintext on the user's own disk and holds saved groups only:
 * never "Now Open", no keys, no tokens, no account id, no sync bookkeeping.
 */

/** How writing the file ended. `no-permission`: the option is on but the browser permission is gone. */
export const BACKUP_FILE_RESULTS = ['saved', 'no-permission', 'failed'] as const;
export type BackupFileResult = (typeof BACKUP_FILE_RESULTS)[number];

export function isBackupFileResult(value: unknown): value is BackupFileResult {
  return (BACKUP_FILE_RESULTS as readonly unknown[]).includes(value);
}

/** What the last file write did, kept for the Settings status line (scheduled runs have no toast). */
export interface BackupFileStatus {
  at: number;
  result: BackupFileResult;
  /** path relative to Downloads */
  path: string;
}

export function parseBackupFileStatus(raw: unknown): BackupFileStatus | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.at !== 'number' || !Number.isFinite(r.at) || !isBackupFileResult(r.result) || typeof r.path !== 'string') return null;
  return { at: r.at, result: r.result, path: r.path.slice(0, 300) };
}

/**
 * The file's text: the Export format (a JSON array of groups), saved groups only, without this
 * device's sync bookkeeping (`LOCAL_ONLY_SYNC_KEYS`, shared with the web dashboard's download).
 * The keys are removed at every level, not only on the group where the extension writes them, so
 * both writers produce the same file for the same backup whatever the stored content holds.
 */
export function backupFileContent(groups: Group[]): string {
  const saved = withoutLocalOnlySyncKeys(groups.filter((g) => !g.permanent)) as Group[];
  return exportGroups(saved);
}

/** Whether the browser currently lets this extension save files. Never throws. */
export async function hasBackupFilePermission(): Promise<boolean> {
  try {
    if (typeof chrome === 'undefined' || !chrome.permissions?.contains) return false;
    return await chrome.permissions.contains({ permissions: [BACKUP_FILE_PERMISSION] });
  } catch {
    return false;
  }
}

/** Base64 of a string's UTF-8 bytes, built in chunks (`btoa` on one huge argument list overflows the stack). */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/**
 * A URL `chrome.downloads.download` can fetch the text from. A service worker (Chrome, Edge) has
 * no `URL.createObjectURL`, so there it is a `data:` URL; a background PAGE (Firefox) has it and
 * Firefox does not accept `data:` URLs for downloads, so there it is a blob URL.
 */
function toDownloadUrl(json: string): { url: string; release: () => void } {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob !== 'undefined') {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    // the browser reads the blob after `download` resolves: keep it for a while, then let it go
    return { url, release: () => setTimeout(() => URL.revokeObjectURL(url), 60_000) };
  }
  return { url: `data:application/json;charset=utf-8;base64,${utf8ToBase64(json)}`, release: () => {} };
}

/**
 * Writes one backup as a file. `folder` and `pattern` are the STORED settings: they are validated
 * again here (see `buildBackupFilePath`), never trusted, so the path is always inside Downloads.
 * `saveAs: false` so no dialog opens while the user is doing something else, and `uniquify` so an
 * existing file is never overwritten. Never throws: a failure is a result, and the caller's
 * backup stands either way. Old files are never deleted.
 */
export async function saveBackupFile(session: Pick<Session, 'groups' | 'createdAt'>, folder: unknown, pattern: unknown): Promise<{ result: BackupFileResult; path: string }> {
  const groups = session.groups.filter((g) => !g.permanent);
  const path = buildBackupFilePath(folder, pattern, {
    createdAt: session.createdAt,
    groups: groups.length,
    tabs: groups.reduce((sum, g) => sum + getGroupTabCount(g), 0)
  });
  try {
    if (!(await hasBackupFilePermission()) || !chrome.downloads?.download) return { result: 'no-permission', path };
    const { url, release } = toDownloadUrl(backupFileContent(groups));
    try {
      const id = await chrome.downloads.download({ url, filename: path, saveAs: false, conflictAction: 'uniquify' });
      return { result: typeof id === 'number' ? 'saved' : 'failed', path };
    } finally {
      release();
    }
  } catch (e) {
    console.warn('[TabMerger] Backup file could not be saved', e);
    return { result: 'failed', path };
  }
}
