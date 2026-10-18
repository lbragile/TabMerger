import { nanoid } from 'nanoid';
import { lazyMessages } from '@/lib/i18n';
import { AUTO_BACKUP_DOWNLOAD_LIMITS, AUTO_BACKUP_RETENTION_COUNT, autoBackupName, decryptBlob, isEncryptedBlob } from '@tabmerger/shared';
import type { Group, Session } from '@/lib/types';
import { getSessions, getSetting, commitSessionsIfGuardHolds } from '@/lib/localDb';
import { supabase } from '@/lib/supabase';
import { getContentUploadKey } from '@/lib/contentUploadKey';
import { importGroups } from '@/lib/importExport';
import { isSignedInAs } from '@/lib/sessionUpload';
import { syncRequestSignal } from '@/lib/syncRequest';
import { AUTO_BACKUP_STATE_KEY, AUTO_BACKUP_STORE_GUARD_KEY } from '@/lib/syncSettingKeys';
import {
  backupIdentityHolds,
  claimBackupStore,
  flushPendingRemoteDeletes,
  getPendingRemoteDeletes,
  isAutoBackup,
  isBackupId,
  parseAutoBackupState,
  withBackupLock,
  type AutoBackupState
} from '@/lib/autoBackup';

/**
 * Brings the account's AUTOMATIC backups back onto this device (after a reinstall, on a new
 * browser profile, after local data was lost or cleared). Sessions the user saved by hand are not
 * downloaded: only rows whose DECRYPTED content carries `auto: true` are kept.
 *
 * It only ever ADDS: nothing local is overwritten or removed, whatever the account holds. A
 * backup that is on this device and not in the account (never uploaded, or deleted in the web
 * dashboard, which removes only the cloud copy) stays on this device. Nothing on the server is
 * changed either, except that deletes the user already made on this device, and rotation already
 * did here, are retried first. It never rotates. It runs from the Settings panel, never on a
 * timer and never inside a groups sync cycle. No React here.
 */

/** Newest rows read from `sessions`. The server cannot tell backups from saved sessions, so this bounds the download. */
export const MAX_BACKUP_ROWS = AUTO_BACKUP_DOWNLOAD_LIMITS.rows;
/** A backup holding more groups than this is not accepted. */
export const MAX_BACKUP_GROUPS = AUTO_BACKUP_DOWNLOAD_LIMITS.groupsPerBackup;
const MAX_BACKUP_NAME_LENGTH = AUTO_BACKUP_DOWNLOAD_LIMITS.nameLength;
/** No backup can be older than the feature, or (beyond clock skew) from the future. */
const MIN_BACKUP_TIME = Date.UTC(2020, 0, 1);
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/** A `sessions` row as selected for the download. Nothing in it is trusted. */
export interface RemoteSessionRow {
  id?: unknown;
  groups?: unknown;
  created_at?: unknown;
}

/** The creation time of a row when it is a real, plausible date; otherwise `null`. */
export function parseBackupCreatedAt(raw: unknown, now: number): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const ms = typeof raw === 'number' ? raw : Date.parse(raw);
  if (!Number.isFinite(ms) || ms < MIN_BACKUP_TIME || ms > now + MAX_FUTURE_SKEW_MS) return null;
  return ms;
}

const cut = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

/**
 * Applies {@link AUTO_BACKUP_DOWNLOAD_LIMITS} to groups that already went through the import
 * sanitiser, which checks types and addresses but not sizes. Windows and tabs beyond their count,
 * and tabs with an over-long address, are left out and counted in `dropped`; over-long text is
 * cut. A group id that is not a short URL-safe id (the content chose it) is replaced by a new one.
 * This is the download's own layer: `importExport.ts` and regular file imports are not changed.
 */
export function capDownloadedGroups(groups: Group[]): { groups: Group[]; dropped: number } {
  const L = AUTO_BACKUP_DOWNLOAD_LIMITS;
  let dropped = 0;
  const capped = groups.map((g) => {
    const windows = g.windows.slice(0, L.windowsPerGroup).map((w) => {
      const fits = w.tabs.filter((t) => t.url.length <= L.urlLength);
      const tabs = fits.slice(0, L.tabsPerWindow).map((t) => ({
        ...t,
        title: cut(t.title, L.titleLength),
        ...(t.customTitle !== undefined ? { customTitle: cut(t.customTitle, L.titleLength) } : {}),
        ...(t.note !== undefined ? { note: cut(t.note, L.noteLength) } : {})
      }));
      dropped += w.tabs.length - tabs.length;
      return {
        ...w,
        tabs,
        ...(w.name !== undefined ? { name: cut(w.name, L.nameLength) } : {}),
        ...(w.note !== undefined ? { note: cut(w.note, L.noteLength) } : {})
      };
    });
    dropped += g.windows.length - windows.length;
    return {
      ...g,
      id: isBackupId(g.id) ? g.id : nanoid(10),
      name: cut(g.name, L.nameLength),
      windows,
      ...(g.note !== undefined ? { note: cut(g.note, L.noteLength) } : {})
    };
  });
  return { groups: capped, dropped };
}

/**
 * Builds a local backup from a row's id, time and DECRYPTED content, or `null` when it is not an
 * automatic backup or anything about it is off. The content came from the network, so it is
 * handled like an imported file: only the literal `auto: true` counts, the groups go through the
 * import sanitiser (rebuilt field by field, script-running addresses dropped), and the name is a
 * bounded string or is rebuilt from the date. A backup left with no groups is dropped. Sizes are
 * bounded by {@link capDownloadedGroups}; `dropped` counts the windows and tabs it left out.
 */
export function buildDownloadedBackup(id: unknown, createdAtRaw: unknown, content: unknown, now: number): { backup: Session; dropped: number } | null {
  if (!isBackupId(id)) return null;
  if (typeof content !== 'object' || content === null || Array.isArray(content)) return null;
  const c = content as Record<string, unknown>;
  if (c.auto !== true) return null;
  const createdAt = parseBackupCreatedAt(createdAtRaw, now);
  if (createdAt === null) return null;
  if (!Array.isArray(c.groups) || c.groups.length === 0 || c.groups.length > MAX_BACKUP_GROUPS) return null;

  let sanitised: Session['groups'];
  try {
    sanitised = importGroups(JSON.stringify(c.groups)).groups;
  } catch {
    return null;
  }
  if (sanitised.length === 0) return null;
  const { groups, dropped } = capDownloadedGroups(sanitised);

  const name = typeof c.name === 'string' && c.name.trim() !== '' ? c.name.slice(0, MAX_BACKUP_NAME_LENGTH) : autoBackupName(createdAt);
  return { backup: { id, name, groups, createdAt, auto: true }, dropped };
}

/** {@link buildDownloadedBackup} without the count. */
export function toDownloadedBackup(id: unknown, createdAtRaw: unknown, content: unknown, now: number): Session | null {
  return buildDownloadedBackup(id, createdAtRaw, content, now)?.backup ?? null;
}

/**
 * Which downloaded backups to add to the local store.
 *  - never one whose id is already local (a local backup is never overwritten);
 *  - never one this device deleted and has not confirmed deleted on the server yet;
 *  - only those that are among the newest `keep` automatic backups of local + downloaded
 *    together, so the download never adds something the next rotation would remove.
 * Local backups are never removed here, whatever the server holds.
 */
export function selectBackupsToAdd(local: Session[], downloaded: Session[], pendingDeletes: Iterable<string>, keep: number = AUTO_BACKUP_RETENTION_COUNT): Session[] {
  const localIds = new Set(local.map((s) => s.id));
  const blocked = new Set(pendingDeletes);
  const seen = new Set<string>();
  const candidates = downloaded.filter((s) => {
    if (!isAutoBackup(s) || localIds.has(s.id) || blocked.has(s.id) || seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  const candidateIds = new Set(candidates.map((s) => s.id));
  return [...local.filter(isAutoBackup), ...candidates]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(0, keep))
    .filter((s) => candidateIds.has(s.id));
}

/**
 * The state to store after a download, or `null` to leave it alone. Only a device with NO state
 * (it has never taken a backup: a fresh install) is seeded, with the time and id of the newest
 * backup now on it and an empty fingerprint. So the schedule continues from the account's last
 * backup instead of firing at once on a device that is still getting its groups back, and the
 * first backup it takes is always compared as "changed" (the downloaded copy was rebuilt by the
 * sanitiser, so its fingerprint would not match the live groups anyway).
 */
export function seedStateAfterDownload(current: AutoBackupState | null, added: Session[]): AutoBackupState | null {
  if (current || added.length === 0) return null;
  const newest = added.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  return { lastBackupAt: newest.createdAt, fingerprint: '', lastBackupId: newest.id };
}

export type BackupDownloadBlockedReason =
  | 'signed-out'
  /** the local store still holds another account's data */
  | 'account-mismatch'
  /** encryption was never set up for this account: nothing readable can exist */
  | 'no-key'
  /** the encryption status could not be checked (offline, server error) */
  | 'key-unknown'
  /** a key exists but this device has not unlocked it */
  | 'locked'
  /** the request for the backups failed (offline, server error) */
  | 'fetch-failed'
  /** the signed-in account changed, or the local store was wiped, while the download ran: nothing was stored */
  | 'identity-changed';

export type BackupDownloadResult =
  /**
   * `inAccount` = automatic backups found in the account and readable; `unreadable` = encrypted
   * rows that would not decrypt; `dropped` = windows and tabs left out of the stored backups by
   * the size limits; `removed` = local backups removed by the download, which is ALWAYS 0: a
   * backup that is on this device and not in the account stays on this device.
   */
  | { status: 'done'; added: number; inAccount: number; unreadable: number; dropped: number; removed: 0 }
  | { status: 'blocked'; reason: BackupDownloadBlockedReason }
  /** a backup run or another download holds the lock; nothing was done */
  | { status: 'busy' };

/** Plain-language line for each reason the download could not run. */
export const BACKUP_DOWNLOAD_MESSAGES: Readonly<Record<BackupDownloadBlockedReason, string>> = lazyMessages({
  'signed-out': 'backups.download.signedOut',
  'account-mismatch': 'backups.download.accountMismatch',
  'no-key': 'backups.download.noKey',
  'key-unknown': 'backups.download.keyUnknown',
  locked: 'backups.download.locked',
  'fetch-failed': 'backups.download.fetchFailed',
  'identity-changed': 'backups.download.identityChanged'
});

/**
 * Decrypts the rows and keeps the valid automatic backups. A row that is not `{v:1,iv,ct}`
 * ciphertext is skipped (content is never read as plaintext); a row that fails to decrypt is
 * counted and skipped, it never fails the whole download. `skipIds` are not even decrypted.
 */
export async function decryptAutoBackupRows(
  rows: unknown,
  key: CryptoKey,
  skipIds: Set<string>,
  now: number
): Promise<{ backups: Session[]; unreadable: number; dropped: number }> {
  const backups: Session[] = [];
  let unreadable = 0;
  let dropped = 0;
  if (!Array.isArray(rows)) return { backups, unreadable, dropped };
  for (const row of rows.slice(0, MAX_BACKUP_ROWS) as RemoteSessionRow[]) {
    if (typeof row !== 'object' || row === null) continue;
    if (!isBackupId(row.id) || skipIds.has(row.id)) continue;
    if (!isEncryptedBlob(row.groups)) continue;
    let content: unknown;
    try {
      content = await decryptBlob<unknown>(key, row.groups);
    } catch {
      unreadable++;
      continue;
    }
    const built = buildDownloadedBackup(row.id, row.created_at, content, now);
    if (!built) continue;
    backups.push(built.backup);
    dropped += built.dropped;
  }
  return { backups, unreadable, dropped };
}

/**
 * Downloads the signed-in user's automatic backups and adds the missing ones locally.
 * Reading your own `sessions` rows is not limited to paid accounts, so a user who is no longer
 * on Pro still gets theirs back. Never throws: a failure is a `blocked` result and leaves every
 * local backup exactly as it was.
 */
export async function downloadAutoBackups(now: number = Date.now()): Promise<BackupDownloadResult> {
  try {
    const result = await withBackupLock(() => downloadLocked(now));
    return result.ran ? result.value : { status: 'busy' };
  } catch (e) {
    console.warn('[TabMerger] Backup download failed', e);
    return { status: 'blocked', reason: 'fetch-failed' };
  }
}

async function downloadLocked(now: number): Promise<BackupDownloadResult> {
  const blocked = (reason: BackupDownloadBlockedReason): BackupDownloadResult => ({ status: 'blocked', reason });

  // The download acts for ONE account, the one signed in now (same rule as a backup run, see
  // runAutoBackup): every later step is for this user id or does not happen.
  const claim = await claimBackupStore();
  if ('blocked' in claim) return blocked(claim.blocked);
  const { userId } = claim;

  // the key of THIS user or none: the lookup answers "unknown" if someone else is signed in by then
  const gate = await getContentUploadKey(userId);
  if (!(await isSignedInAs(userId))) return blocked('identity-changed');
  if (!gate.key) return blocked(gate.reason === 'unknown' ? 'key-unknown' : gate.reason);

  // Deletes this device already decided on go first; whatever is still unconfirmed is kept out below.
  const pendingDeletes = await flushPendingRemoteDeletes(userId);

  const { data, error } = await supabase
    .from('sessions')
    .select('id, groups, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_BACKUP_ROWS)
    // bounded: this runs under the backup lock, which a request the network never answers would hold
    .abortSignal(syncRequestSignal());
  if (error || !Array.isArray(data)) return blocked('fetch-failed');
  // A signed-out or swapped client is answered "no rows" without an error (RLS): such an answer
  // says nothing about this account, and must never be read as "everything was deleted".
  if (!(await isSignedInAs(userId))) return blocked('identity-changed');

  // A local backup the account does not have (never uploaded, or deleted in the web dashboard)
  // is left exactly where it is: absence on the server never deletes anything here.
  const local = await getSessions();
  // The pending deletes are read AGAIN, and AFTER the sessions: a backup the user deleted while
  // the request above was in flight is gone from `local` and was not in the list read before the
  // request, so without this it would be decrypted and put back. The delete is ONE transaction
  // (session removed + id noted), so whichever side of the sessions read it lands on, one of the
  // two reads shows it: before, the id is in this list; after, the session is still in `local`.
  // Nothing takes an id off the list meanwhile: that only happens under the lock this holds.
  const blockedIds = new Set([...pendingDeletes, ...(await getPendingRemoteDeletes())]);
  const localIds = new Set(local.map((s) => s.id));
  // Rows already on this device (or deleted here) are counted without being decrypted again.
  const known = data.filter((r) => isBackupId((r as RemoteSessionRow)?.id) && localIds.has((r as RemoteSessionRow).id as string));
  const knownAuto = known.filter((r) => local.some((s) => s.id === (r as RemoteSessionRow).id && isAutoBackup(s))).length;
  const { backups, unreadable, dropped } = await decryptAutoBackupRows(data, gate.key, new Set([...localIds, ...blockedIds]), now);

  // what is added is on the server by definition: marked so, like a backup this device uploaded
  const toAdd = selectBackupsToAdd(local, backups, blockedIds).map((s) => ({ ...s, uploadedAt: now }));
  const seeded = seedStateAfterDownload(parseAutoBackupState(await getSetting<unknown>(AUTO_BACKUP_STATE_KEY, null)), toAdd);

  // The rows were requested, and decrypted, for `userId`. They are stored only if that is still
  // the signed-in account, and in ONE transaction that fails if the store was wiped since the
  // download started (account switch, Clear all data): backups and seeded state land together
  // or not at all.
  if (!(await backupIdentityHolds(userId))) return blocked('identity-changed');
  if (toAdd.length > 0) {
    const committed = await commitSessionsIfGuardHolds(
      { key: AUTO_BACKUP_STORE_GUARD_KEY, value: userId },
      // the download only ADDS: it never deletes a local session, whatever the server holds
      { putSessions: toAdd, deleteSessionIds: [], settings: seeded ? { [AUTO_BACKUP_STATE_KEY]: seeded } : {} }
    );
    if (!committed) return blocked('identity-changed');
  }

  return { status: 'done', added: toAdd.length, inAccount: knownAuto + backups.length, unreadable, dropped, removed: 0 };
}
