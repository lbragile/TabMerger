import { nanoid } from 'nanoid';
import {
  AUTO_BACKUP_FREE_RECHECK_MS,
  AUTO_BACKUP_RETENTION_COUNT,
  autoBackupName,
  isAutoBackupDue,
  DEFAULT_BACKUP_FILE_ENABLED,
  normalizeAutoBackupEnabled,
  normalizeAutoBackupInterval,
  normalizeBackupFilePattern,
  normalizeBackupFolder,
  type AutoBackupIntervalMinutes
} from '@tabmerger/shared';
import type { Group, Session } from '@/lib/types';
import { isTourDemoGroup } from '@tabmerger/shared';
import { TIER_LIMITS } from '@/lib/types';
import { getGroupsState, getSessions, deleteSession, getSetting, setSetting, commitSessions, commitSessionsIfGuardHolds, compareAndSetSetting } from '@/lib/localDb';
import { supabase } from '@/lib/supabase';
import { fetchTier } from '@/lib/entitlementTier';
import { pushSessionToSupabase, deleteRemoteSessions, isSignedInAs } from '@/lib/sessionUpload';
import { saveBackupFile, isBackupFileResult, type BackupFileResult, type BackupFileStatus } from '@/lib/autoBackupFile';
import {
  APP_SETTINGS_KEY,
  AUTO_BACKUP_FILE_STATUS_KEY,
  AUTO_BACKUP_FREE_SEEN_KEY,
  AUTO_BACKUP_PENDING_DELETES_KEY,
  AUTO_BACKUP_STATE_KEY,
  AUTO_BACKUP_STORE_GUARD_KEY,
  LAST_USER_ID_KEY,
  REARMED_BY_BACKUP,
  SESSIONS_MIGRATION_DONE_KEY
} from '@/lib/syncSettingKeys';

/**
 * Automatic backups (Pro). A backup is a `Session` marked `auto: true` holding every saved
 * (non-permanent) group, written to IndexedDB and uploaded encrypted through the same path as a
 * session the user saved. This module has no React and no `chrome.*` in it: the background worker
 * runs it on an alarm, and everything that decides something is a pure exported function.
 *
 * It never runs a groups sync cycle: it only reads the groups, writes a session and uploads it.
 */

/** The backup settings, validated. */
export interface AutoBackupSettings {
  enabled: boolean;
  intervalMinutes: AutoBackupIntervalMinutes;
  /** "Also save a file to this computer": folder (relative to Downloads) and file name pattern, both already validated. */
  file: { enabled: boolean; folder: string; pattern: string };
}

/**
 * Reads the backup settings out of a stored `appSettings` value. Settings objects saved before
 * this feature existed lack both keys, and a stored value is never trusted: anything that is not
 * a boolean / an allow-listed interval becomes the default.
 */
export function readAutoBackupSettings(appSettings: unknown): AutoBackupSettings {
  const raw = typeof appSettings === 'object' && appSettings !== null ? (appSettings as Record<string, unknown>) : {};
  return {
    enabled: normalizeAutoBackupEnabled(raw.autoBackupEnabled),
    intervalMinutes: normalizeAutoBackupInterval(raw.autoBackupIntervalMinutes),
    file: {
      // only a real boolean turns it on; the folder and pattern become a path on disk, so a
      // stored value that does not validate is replaced by its default
      enabled: typeof raw.autoBackupFileEnabled === 'boolean' ? raw.autoBackupFileEnabled : DEFAULT_BACKUP_FILE_ENABLED,
      folder: normalizeBackupFolder(raw.autoBackupFileFolder),
      pattern: normalizeBackupFilePattern(raw.autoBackupFilePattern)
    }
  };
}

/** What is remembered about the last automatic backup (settings store, `AUTO_BACKUP_STATE_KEY`). */
export interface AutoBackupState {
  /** epoch ms the last backup was taken */
  lastBackupAt: number;
  /** {@link fingerprintGroups} of what it held */
  fingerprint: string;
  /** its session id: "unchanged" only counts while that backup still exists */
  lastBackupId: string;
}

/** A stuck backlog of remote deletes must not grow forever. */
export const MAX_PENDING_REMOTE_DELETES = 100;

/** A session id as this extension generates them (nanoid): short, URL-safe characters only. */
export function isBackupId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/** The stored pending-delete list, keeping only well-formed ids (newest last, capped). */
export function parsePendingRemoteDeletes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isBackupId))].slice(-MAX_PENDING_REMOTE_DELETES);
}

export async function getPendingRemoteDeletes(): Promise<string[]> {
  return parsePendingRemoteDeletes(await getSetting<unknown>(AUTO_BACKUP_PENDING_DELETES_KEY, []));
}

/**
 * The sessions "nothing left to upload" flag as a backup commit leaves it, from the value stored
 * when that transaction runs: `true` becomes {@link REARMED_BY_BACKUP} (this backup is the only
 * thing left, see there), anything else becomes `false`.
 */
export const rearmSessionsFlagForBackup = (stored: unknown): false | typeof REARMED_BY_BACKUP => (stored === true ? REARMED_BY_BACKUP : false);

/** The guard every backup write is conditional on: the store is still claimed for `userId`. */
const storeGuard = (userId: string) => ({ key: AUTO_BACKUP_STORE_GUARD_KEY, value: userId });

/**
 * Start of every backup run and download: who is signed in, and is the local store theirs
 * (same rule as a sync cycle, syncEngine's checkCycleIdentity)? On success the store is CLAIMED
 * for that user id (see `AUTO_BACKUP_STORE_GUARD_KEY`) and the id is returned: it is the only
 * identity the rest of the operation may act for, however the signed-in account changes later.
 */
export async function claimBackupStore(): Promise<{ userId: string } | { blocked: 'signed-out' | 'account-mismatch' }> {
  const { data: { session: authSession } } = await supabase.auth.getSession();
  if (!authSession) return { blocked: 'signed-out' };
  const userId = authSession.user.id;
  const owner = await getSetting<string | null>(LAST_USER_ID_KEY, null);
  if (owner && owner !== userId) return { blocked: 'account-mismatch' };
  await setSetting(AUTO_BACKUP_STORE_GUARD_KEY, userId);
  return { userId };
}

/**
 * Whether an operation that claimed the store for `userId` may still act for them: the client's
 * session is still theirs, the store's recorded owner is not someone else, and the claim has not
 * been removed by a wipe. Checked again before each local write and each request.
 */
export async function backupIdentityHolds(userId: string): Promise<boolean> {
  if (!(await isSignedInAs(userId))) return false;
  const owner = await getSetting<string | null>(LAST_USER_ID_KEY, null);
  if (owner && owner !== userId) return false;
  return (await getSetting<unknown>(AUTO_BACKUP_STORE_GUARD_KEY, null)) === userId;
}

/**
 * A change to the stored pending-delete list that adds `ids`, for `updateSettings` of a sessions
 * commit: it is applied to the list stored when that transaction runs, so two writers (the popup
 * deleting a backup, the worker rotating) can never overwrite each other's ids.
 */
export const addPendingRemoteDeletes =
  (ids: string[]) =>
  (stored: unknown): string[] =>
    parsePendingRemoteDeletes([...parsePendingRemoteDeletes(stored), ...ids]);

/**
 * Sends the remembered deletes (plus `extra`) to the server for `userId`. Whatever is not
 * confirmed deleted stays remembered; `extra` is written to the list BEFORE the request so a
 * stopped worker cannot lose it, and afterwards only the ids that were SENT are taken off the
 * list (an id another context added while the request ran stays). Both writes are conditional on
 * the store still being claimed for `userId`, and the request is refused unless the client is
 * still signed in as them. Resolves with the ids still pending afterwards.
 */
export async function flushPendingRemoteDeletes(userId: string, extra: string[] = []): Promise<string[]> {
  let ids: string[] = [];
  const remember = (stored: unknown) => (ids = addPendingRemoteDeletes(extra)(stored));
  if (!(await commitSessionsIfGuardHolds(storeGuard(userId), { updateSettings: { [AUTO_BACKUP_PENDING_DELETES_KEY]: remember } }))) {
    return parsePendingRemoteDeletes([...(await getPendingRemoteDeletes()), ...extra]);
  }
  if (ids.length === 0) return [];
  if (!(await deleteRemoteSessions(ids, userId))) return ids;
  const sent = new Set(ids);
  let left: string[] = ids;
  const forget = (stored: unknown) => (left = parsePendingRemoteDeletes(stored).filter((id) => !sent.has(id)));
  await commitSessionsIfGuardHolds(storeGuard(userId), { updateSettings: { [AUTO_BACKUP_PENDING_DELETES_KEY]: forget } });
  return left;
}

/**
 * Deletes one automatic backup the user chose to remove: locally now, on the server as soon as
 * that can be confirmed. The local delete and the note of its id are ONE transaction, and the id
 * stays in the pending list until the server confirmed, so a later download of the account's
 * backups cannot bring it back.
 *
 * The request is sent under the backup lock, like a run and a download: claiming the store
 * outside it could put the claim back while a run that started before a wipe was still going,
 * and that run would then write into the wiped store. If a run or a download holds the lock, or
 * nobody is signed in, or the store is not the signed-in account's, nothing is sent now: the id
 * is remembered and the next run or download sends it.
 */
export async function deleteAutoBackup(id: string): Promise<void> {
  if (!isBackupId(id)) {
    await deleteSession(id);
    return;
  }
  await commitSessions({ deleteSessionIds: [id], updateSettings: { [AUTO_BACKUP_PENDING_DELETES_KEY]: addPendingRemoteDeletes([id]) } });
  try {
    await withBackupLock(async () => {
      const claim = await claimBackupStore();
      if ('userId' in claim) await flushPendingRemoteDeletes(claim.userId);
    });
  } catch (e) {
    console.warn('[TabMerger] Backup delete not sent yet', e);
  }
}

/** Whether the stored "this account is not paid" answer is for `userId` and still fresh. */
export function isFreeAnswerFresh(raw: unknown, userId: string, now: number): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (r.userId !== userId || typeof r.at !== 'number' || !Number.isFinite(r.at)) return false;
  return r.at <= now && now - r.at < AUTO_BACKUP_FREE_RECHECK_MS;
}

/** The stored state when it has exactly the expected shape, otherwise `null` ("no backup yet"). */
export function parseAutoBackupState(raw: unknown): AutoBackupState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.lastBackupAt !== 'number' || !Number.isFinite(r.lastBackupAt) || r.lastBackupAt <= 0) return null;
  if (typeof r.fingerprint !== 'string' || typeof r.lastBackupId !== 'string') return null;
  return { lastBackupAt: r.lastBackupAt, fingerprint: r.fingerprint, lastBackupId: r.lastBackupId };
}

/**
 * The groups a backup holds: every saved group, never "Now Open" and never the guided tour's
 * practice groups. Same selection as `useSaveSession`.
 */
export function backupGroups(available: Group[]): Group[] {
  return available.filter((g) => !g.permanent && !isTourDemoGroup(g));
}

/** Per-group fields that change without the user's content changing (sync bookkeeping, stamps, derived text). */
const FINGERPRINT_IGNORED_KEYS = new Set(['pendingSync', 'positionDirty', 'remoteUpdatedAt', 'updatedAt', 'info']);

/** JSON with object keys sorted, so two equal values always serialise the same way. */
function stableStringify(value: unknown, ignoreKeys?: Set<string>): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([k, v]) => v !== undefined && !ignoreKeys?.has(k))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * A short fingerprint (SHA-256, hex) of the groups' CONTENT, in order. Sync bookkeeping and
 * timestamps are left out, so a sync or a pull that changed nothing the user can see does not
 * count as a change. Used to skip a backup identical to the previous one.
 */
export async function fingerprintGroups(groups: Group[]): Promise<string> {
  const canonical = `[${groups.map((g) => stableStringify(g, FINGERPRINT_IGNORED_KEYS)).join(',')}]`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Only the literal `true` marks an automatic backup. */
export function isAutoBackup(session: Pick<Session, 'auto'>): boolean {
  return session.auto === true;
}

/**
 * The automatic backups that fall outside the newest `keep`. Sessions the user saved are never
 * returned and never counted, whatever their age.
 */
export function selectAutoBackupsToPrune(sessions: Session[], keep: number = AUTO_BACKUP_RETENTION_COUNT): Session[] {
  return sessions
    .filter(isAutoBackup)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(Math.max(0, keep));
}

/**
 * Every reason a run can end without a backup:
 *  - `disabled`: the switch is off (a manual "Back up now" ignores this);
 *  - `signed-out`;
 *  - `account-mismatch`: the local store still holds another account's data;
 *  - `not-due`: less than one interval since the last backup (a manual run ignores this);
 *  - `empty`: there are no saved groups (an empty or wiped store must never push good backups out);
 *  - `unchanged`: the saved groups are identical to the last automatic backup, which still exists;
 *  - `tier-unknown`: the subscription could not be checked (offline, server error);
 *  - `not-entitled`: a free (or no longer paid) account;
 *  - `identity-changed`: the signed-in account changed, or the local store was wiped, while the
 *    run was in progress. It stopped where it was; nothing was written or sent for the other account;
 *  - `busy`: another run is in progress.
 */
export const AUTO_BACKUP_SKIP_REASONS = [
  'disabled',
  'signed-out',
  'account-mismatch',
  'not-due',
  'empty',
  'unchanged',
  'tier-unknown',
  'not-entitled',
  'identity-changed',
  'busy'
] as const;

export type AutoBackupSkipReason = (typeof AUTO_BACKUP_SKIP_REASONS)[number];

export type AutoBackupOutcome =
  /** `file` is present only when "Also save a file to this computer" is on: how that write ended, and where (relative to Downloads). */
  | { status: 'created'; sessionId: string; createdAt: number; uploaded: boolean; pruned: number; file?: BackupFileResult; filePath?: string }
  | { status: 'skipped'; reason: AutoBackupSkipReason }
  | { status: 'error'; message: string };

const BACKUP_LOCK_NAME = 'tabmerger-auto-backup';
const RUNNING = Symbol.for('tabmerger.autoBackupRunning');

/** One run or download at a time across the popup and the worker (same shape as `withSyncLock`). */
export async function withBackupLock<T>(task: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (locks?.request) {
    return locks.request(BACKUP_LOCK_NAME, { ifAvailable: true }, async (lock) => (lock ? { ran: true as const, value: await task() } : { ran: false as const }));
  }
  const g = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (g[RUNNING]) return { ran: false };
  g[RUNNING] = true;
  try {
    return { ran: true, value: await task() };
  } finally {
    g[RUNNING] = false;
  }
}

export interface RunAutoBackupOptions {
  /** "Back up now": ignore the on/off switch and the schedule. Every other check still applies. */
  manual?: boolean;
  /** Ask the server for the plan even if it recently answered "not paid" (a manual run always does). */
  recheckTier?: boolean;
  /** Test seam. */
  now?: number;
}

/**
 * Takes one automatic backup if every condition holds, in this order (local and cheap first, the
 * network check last):
 *  1. the switch is on (unless `manual`);
 *  2. someone is signed in, and the local store is theirs;
 *  3. a backup is due by the stored last-backup time (unless `manual`): the alarm firing is only
 *     the trigger, never the decision;
 *  4. there is at least one saved group;
 *  5. the groups differ from the last automatic backup, or that backup no longer exists;
 *  6. the account is paid, as answered by the server right now. A failed check is "do not run".
 *     A "not paid" answer is remembered for `AUTO_BACKUP_FREE_RECHECK_MS`, during which scheduled
 *     runs stop before any request (a manual run, and the run after a settings change, ask again).
 *
 * Then: write the session locally, remember time + fingerprint, delete automatic backups beyond
 * the retention count (locally and on the server; the backup just made is always kept), and
 * upload the new one encrypted. The sessions self-heal is re-armed in the same transaction that
 * writes the backup, so when the upload does not happen (offline, key locked or not set up,
 * Firefox consent missing, the worker stopped) the backup stays local and the next sync in the
 * popup uploads it. When the upload is confirmed the run takes its own re-arm back (see
 * `REARMED_BY_BACKUP`), so a backup that uploaded does not cause a sessions re-upload pass.
 *
 * Deletes this device still owes the server (see `flushPendingRemoteDeletes`) are sent right
 * after step 2, whether or not a backup follows.
 *
 * The run acts for ONE account: the user id read at the start. The signed-in account can change
 * while it runs (the web app hands the worker a new session; the popup then wipes the store), so
 * identity is checked again before the local write and before each request, the local write is a
 * single transaction that fails if the store was wiped since the start, and the requests carry
 * that user id. Any mismatch ends the run as `identity-changed`.
 */
export async function runAutoBackup(opts: RunAutoBackupOptions = {}): Promise<AutoBackupOutcome> {
  try {
    const result = await withBackupLock(() => runLocked(opts));
    return result.ran ? result.value : { status: 'skipped', reason: 'busy' };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

async function runLocked({ manual = false, recheckTier = false, now = Date.now() }: RunAutoBackupOptions): Promise<AutoBackupOutcome> {
  const skip = (reason: AutoBackupSkipReason): AutoBackupOutcome => ({ status: 'skipped', reason });

  const settings = readAutoBackupSettings(await getSetting<unknown>(APP_SETTINGS_KEY, null));
  if (!manual && !settings.enabled) return skip('disabled');

  const claim = await claimBackupStore();
  if ('blocked' in claim) return skip(claim.blocked);
  const { userId } = claim;
  const guard = storeGuard(userId);

  // Deletes this device still owes the server go out on EVERY run that got this far, also one
  // that ends below as not due / unchanged / empty: a delete the user made while a run or a
  // download held the lock was only remembered, and must not wait for a run that creates a
  // backup. With nothing remembered this is one local transaction and no request; the request is
  // bounded and refused unless the client is still signed in as this user.
  await flushPendingRemoteDeletes(userId);

  const state = parseAutoBackupState(await getSetting<unknown>(AUTO_BACKUP_STATE_KEY, null));
  if (!manual && !isAutoBackupDue(state?.lastBackupAt, settings.intervalMinutes, now)) return skip('not-due');

  // The server said "not paid" recently: do not ask again on every alarm and worker start.
  if (!manual && !recheckTier && isFreeAnswerFresh(await getSetting<unknown>(AUTO_BACKUP_FREE_SEEN_KEY, null), userId, now)) {
    return skip('not-entitled');
  }

  const groups = backupGroups((await getGroupsState()).available);
  if (groups.length === 0) return skip('empty');

  const fingerprint = await fingerprintGroups(groups);
  const existing = await getSessions();
  if (state && state.fingerprint === fingerprint && existing.some((s) => s.id === state.lastBackupId && isAutoBackup(s))) {
    return skip('unchanged');
  }

  const tier = await fetchTier(userId);
  if (tier === null) return skip('tier-unknown');
  if (!TIER_LIMITS[tier].cloudSync) {
    await commitSessionsIfGuardHolds(guard, { settings: { [AUTO_BACKUP_FREE_SEEN_KEY]: { userId, at: now } } });
    return skip('not-entitled');
  }

  // Everything above took time (IndexedDB, a request): is this still the account the run started for?
  if (!(await backupIdentityHolds(userId))) return skip('identity-changed');

  const session: Session = { id: nanoid(10), name: autoBackupName(now), groups, createdAt: now, auto: true };
  // Rotation only ever follows a backup that was just written, so it can never empty the list.
  // The new backup is NOT part of the selection: it takes one of the kept places whatever its
  // date. Sorted in with the others, a clock that was moved back would make it the "oldest" and
  // delete it in the very transaction that wrote it.
  const stale = selectAutoBackupsToPrune(existing, AUTO_BACKUP_RETENTION_COUNT - 1);
  const staleIds = stale.map((s) => s.id);
  const nextState: AutoBackupState = { lastBackupAt: now, fingerprint, lastBackupId: session.id };
  // ONE transaction, conditional on the store still being claimed for this user: the new backup,
  // the rotation, the state and the ids to delete remotely land together or not at all. A store
  // wiped since the run started (account switch, Clear all data) gets none of it. It is also
  // written BEFORE any request, so a worker stopped mid-run cannot take the same backup again.
  const committed = await commitSessionsIfGuardHolds(guard, {
    putSessions: [session],
    deleteSessionIds: staleIds,
    settings: {
      [AUTO_BACKUP_STATE_KEY]: nextState,
      // a paid answer supersedes a remembered "not paid" one
      [AUTO_BACKUP_FREE_SEEN_KEY]: null
    },
    updateSettings: {
      // added to the list as stored when this transaction runs, never to an earlier read of it
      [AUTO_BACKUP_PENDING_DELETES_KEY]: addPendingRemoteDeletes(staleIds),
      // The new backup is not on the server yet. Sessions have no per-row pending flag, so the
      // sessions self-heal is re-armed HERE, with the backup: a worker stopped anywhere after
      // this line leaves a backup the next sync still uploads (see useSync). A flag that was
      // `true` gets the backup's own marker, which the run turns back into `true` once the upload
      // is confirmed (below); anything else was already "work left" for another reason and
      // becomes a plain `false`, which this run never clears.
      [SESSIONS_MIGRATION_DONE_KEY]: rearmSessionsFlagForBackup
    }
  });
  if (!committed) return skip('identity-changed');

  // The copy on this computer, if the user asked for one. It follows the local snapshot and does
  // not depend on the upload; a failed write is reported but never fails the backup. Nothing is
  // ever deleted from disk, whatever the rotation above removed.
  let file: { result: BackupFileResult; path: string } | undefined;
  if (settings.file.enabled) {
    file = await saveBackupFile(session, settings.file.folder, settings.file.pattern);
    const status: BackupFileStatus = { at: now, result: file.result, path: file.path };
    await commitSessionsIfGuardHolds(guard, { settings: { [AUTO_BACKUP_FILE_STATUS_KEY]: status } });
  }

  // The backup is on this device, in its owner's store. From here on only requests remain, and
  // each one is refused (client check, then RLS on `user_id`) unless the session is still theirs.
  if (!(await backupIdentityHolds(userId))) {
    // Not uploaded: if the store is STILL this user's (they may sign back in), let the next sync
    // upload it. Conditional like every other write, so it cannot land in a wiped store.
    await commitSessionsIfGuardHolds(guard, { settings: { [SESSIONS_MIGRATION_DONE_KEY]: false } });
    return skip('identity-changed');
  }
  // The server rows of rotated-out backups go too. A delete that could not be confirmed (offline)
  // stays remembered and is retried by the next run.
  await flushPendingRemoteDeletes(userId);

  let uploaded = false;
  try {
    uploaded = await pushSessionToSupabase(session, userId);
  } catch (e) {
    console.warn('[TabMerger] Automatic backup upload failed', e);
  }
  if (uploaded) {
    // Remember that the server has it: from now on it is never INSERTED again (see `uploadedAt`).
    const stamped = await commitSessionsIfGuardHolds(guard, { markUploaded: { ids: [session.id], at: now } });
    // The one thing this run left to upload is on the server: if the flag still holds this run's
    // marker, every session is uploaded again and no sync pass is needed. A `false` or a pass
    // marker written since (a failed save, an encryption reset, a pass that started) is not
    // this value, so it stays, and that pass finishes the job. Not after a wipe (guard gone).
    if (stamped) await compareAndSetSetting(SESSIONS_MIGRATION_DONE_KEY, REARMED_BY_BACKUP, true);
  } else {
    // Sessions have no per-row pending flag: re-arm the self-heal and the next sync uploads it (see useSync).
    await commitSessionsIfGuardHolds(guard, { settings: { [SESSIONS_MIGRATION_DONE_KEY]: false } });
  }

  return { status: 'created', sessionId: session.id, createdAt: now, uploaded, pruned: stale.length, ...(file ? { file: file.result, filePath: file.path } : {}) };
}

/** The outcome when it has a shape this module produces; `null` for anything else (a reply is never trusted blindly). */
export function parseAutoBackupOutcome(raw: unknown): AutoBackupOutcome | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.status === 'created' && typeof r.sessionId === 'string' && typeof r.createdAt === 'number') {
    return {
      status: 'created',
      sessionId: r.sessionId,
      createdAt: r.createdAt,
      uploaded: r.uploaded === true,
      pruned: typeof r.pruned === 'number' ? r.pruned : 0,
      ...(isBackupFileResult(r.file) ? { file: r.file, filePath: typeof r.filePath === 'string' ? r.filePath.slice(0, 300) : '' } : {})
    };
  }
  // an explicit list, not `in` on the messages object: 'toString' or 'constructor' must not pass
  const reason = (AUTO_BACKUP_SKIP_REASONS as readonly unknown[]).includes(r.reason) ? (r.reason as AutoBackupSkipReason) : null;
  if (r.status === 'skipped' && reason) {
    return { status: 'skipped', reason };
  }
  if (r.status === 'error') return { status: 'error', message: typeof r.message === 'string' ? r.message : '' };
  return null;
}

const SKIP_MESSAGES: Record<AutoBackupSkipReason, string> = {
  disabled: 'Automatic backups are turned off.',
  'signed-out': 'Sign in to back up your groups.',
  'account-mismatch': 'This device still holds another account\'s data. Reopen TabMerger and try again.',
  'not-due': 'A backup is not due yet.',
  empty: 'There are no saved groups to back up.',
  unchanged: 'Nothing has changed since the last backup.',
  'tier-unknown': 'Could not check your plan. Check your connection and try again.',
  'not-entitled': 'Automatic backups are part of Pro.',
  'identity-changed': 'The signed-in account changed while backing up, so the backup was stopped. Try again.',
  busy: 'A backup is already running.'
};

/** One sentence about the copy on this computer. `path` is relative to the Downloads folder. */
export function describeBackupFile(result: BackupFileResult, path: string): string {
  if (result === 'saved') return `File saved to Downloads/${path}`;
  if (result === 'no-permission') return 'The file was not saved: TabMerger no longer has permission to save files.';
  return 'The file could not be saved to this computer.';
}

/** What to tell the user after "Back up now". `ok` picks the success or the neutral/error toast. */
export function describeAutoBackupOutcome(outcome: AutoBackupOutcome | null): { ok: boolean; message: string } {
  if (!outcome || outcome.status === 'error') return { ok: false, message: 'The backup could not be created. Try again.' };
  if (outcome.status === 'skipped') return { ok: false, message: SKIP_MESSAGES[outcome.reason] };
  const saved = outcome.uploaded ? 'Backup saved.' : 'Backup saved on this device. It will upload the next time TabMerger syncs.';
  return { ok: true, message: outcome.file ? `${saved} ${describeBackupFile(outcome.file, outcome.filePath ?? '')}` : saved };
}
