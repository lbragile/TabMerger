import { BACKUP_FILE_PERMISSION, buildBackupFilePath, isTourDemoGroup, toDisplayPath, withoutLocalOnlySyncKeys } from '@tabmerger/shared';
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
  const saved = withoutLocalOnlySyncKeys(groups.filter((g) => !g.permanent && !isTourDemoGroup(g))) as Group[];
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

/**
 * The last backup file that was written: the browser's id of that download, and when. The id only
 * means something to this browser profile, so it is kept in the local settings store and nowhere
 * else (see `AUTO_BACKUP_FILE_LAST_KEY`).
 */
export interface BackupFileLast {
  id: number;
  at: number;
}

export function parseBackupFileLast(raw: unknown): BackupFileLast | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'number' || !Number.isSafeInteger(r.id) || r.id < 0) return null;
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return null;
  return { id: r.id, at: r.at };
}

/**
 * Where the last backup file is, as the browser reports it now.
 *  - `none`: no file was recorded yet;
 *  - `unavailable`: the browser cannot be asked (no permission, or no downloads API);
 *  - `pending`: the download has not finished;
 *  - `found`: `path` is the absolute path, already cleaned for display (text only);
 *  - `gone`: the file was moved or deleted, the write was interrupted, or the browser no longer
 *    lists that download. No path is given: a path that may be wrong is worse than none.
 */
export type BackupFileLocation =
  | { kind: 'none' }
  | { kind: 'unavailable'; at: number }
  | { kind: 'pending'; id: number; at: number }
  | { kind: 'found'; id: number; at: number; path: string }
  | { kind: 'gone'; at: number };

/**
 * Looks the last file up with `downloads.search({ id })`. Read-only, and only ever for the id
 * this extension stored after its own download: an entry started by anything else is treated as
 * not ours. Everything in the answer is untrusted text (see `toDisplayPath`). Never throws.
 */
export async function locateBackupFile(last: BackupFileLast | null): Promise<BackupFileLocation> {
  if (!last) return { kind: 'none' };
  const { id, at } = last;
  try {
    if (!(await hasBackupFilePermission()) || typeof chrome.downloads?.search !== 'function') return { kind: 'unavailable', at };
    const items: unknown = await chrome.downloads.search({ id });
    const item = Array.isArray(items) ? (items as Partial<chrome.downloads.DownloadItem>[]).find((d) => d?.id === id) : undefined;
    if (!item) return { kind: 'gone', at };
    if (typeof item.byExtensionId === 'string' && item.byExtensionId !== chrome.runtime?.id) return { kind: 'gone', at };
    if (item.exists === false || item.state === 'interrupted') return { kind: 'gone', at };
    if (item.state === 'in_progress') return { kind: 'pending', id, at };
    const path = toDisplayPath(item.filename);
    return path === '' ? { kind: 'gone', at } : { kind: 'found', id, at, path };
  } catch (e) {
    console.warn('[TabMerger] The last backup file could not be looked up', e);
    return { kind: 'unavailable', at };
  }
}

/** Whether this browser can open a folder for the extension at all (Firefox for Android, for one, cannot). */
export function canShowBackupFolder(): boolean {
  if (typeof chrome === 'undefined' || !chrome.downloads) return false;
  return typeof chrome.downloads.show === 'function' || typeof chrome.downloads.showDefaultFolder === 'function';
}

/** What "Show in folder" did: the file was selected in its folder, or only the Downloads folder was opened. */
export type ShowBackupFileResult = 'file' | 'folder' | 'unavailable' | 'failed';

/**
 * Opens the operating system's file manager: on the file with download id `id`, or, with `null`
 * (no last file, or it is gone), on the browser's Downloads folder. Chrome's calls return nothing;
 * Firefox's `show` answers `false` when it could not show the file, and then the Downloads folder
 * is opened instead. Never throws.
 */
export async function showBackupFile(id: number | null): Promise<ShowBackupFileResult> {
  try {
    if (!(await hasBackupFilePermission()) || !canShowBackupFolder()) return 'unavailable';
    if (id !== null && typeof chrome.downloads.show === 'function') {
      const shown: unknown = await (chrome.downloads.show(id) as unknown);
      if (shown !== false) return 'file';
    }
    if (typeof chrome.downloads.showDefaultFolder !== 'function') return 'unavailable';
    await (chrome.downloads.showDefaultFolder() as unknown);
    return 'folder';
  } catch (e) {
    console.warn('[TabMerger] The backup folder could not be opened', e);
    return 'failed';
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
export async function saveBackupFile(
  session: Pick<Session, 'groups' | 'createdAt'>,
  folder: unknown,
  pattern: unknown
): Promise<{ result: BackupFileResult; path: string; downloadId?: number }> {
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
      // `downloadId` (the browser's id of this download) is what the file is found by later
      return typeof id === 'number' ? { result: 'saved', path, downloadId: id } : { result: 'failed', path };
    } finally {
      release();
    }
  } catch (e) {
    console.warn('[TabMerger] Backup file could not be saved', e);
    return { result: 'failed', path };
  }
}
