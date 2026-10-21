import { UPDATE_AVAILABLE_STORAGE_KEY, UPDATE_BANNER_DISMISSED_STORAGE_KEY } from '@tabmerger/shared';

/**
 * "Update available": the browser downloaded a new version but cannot apply it while the extension
 * is running. The background worker records it (`runtime.onUpdateAvailable`), the popup shows a
 * banner with "Restart to update" (`runtime.reload()`), and Settings can ask the browser to check
 * now (`runtime.requestUpdateCheck()`, Chrome and Edge only: Firefox has no such API, see
 * {@link hasUpdateCheckApi}). The state lives in `chrome.storage.local` under
 * {@link UPDATE_AVAILABLE_STORAGE_KEY} and is removed on worker start once the running version
 * has caught up.
 */

export interface PendingUpdate {
  version: string;
  detectedAt: number;
}

/**
 * What "Check for updates" ended with. `unsupported`: a development, unpacked or temporary
 * install, which the browser never updates. `no_api`: a store install on a browser without
 * `runtime.requestUpdateCheck` (Firefox), which updates add-ons on its own schedule.
 */
export type UpdateCheckResult =
  | { status: 'update_available'; version?: string }
  | { status: 'no_update' }
  | { status: 'throttled' }
  | { status: 'unsupported' }
  | { status: 'no_api' }
  | { status: 'error'; message: string };

const VERSION_RE = /^\d+(\.\d+){0,3}$/;

/** A manifest version (1 to 4 dot-separated integers), anything else is not one. */
export function isManifestVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 32 && VERSION_RE.test(value);
}

/** Compares two manifest versions numerically: negative when `a` is older, 0 when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The stored value if it is a well-formed pending update, else null. */
export function parsePendingUpdate(value: unknown): PendingUpdate | null {
  if (!value || typeof value !== 'object') return null;
  const { version, detectedAt } = value as { version?: unknown; detectedAt?: unknown };
  if (!isManifestVersion(version)) return null;
  if (typeof detectedAt !== 'number' || !Number.isFinite(detectedAt)) return null;
  return { version, detectedAt };
}

/** The version this extension is running, or null outside an extension context. */
export function runningVersion(): string | null {
  try {
    const version = chrome.runtime.getManifest().version;
    return isManifestVersion(version) ? version : null;
  } catch {
    return null;
  }
}

async function readLocal(key: string): Promise<unknown> {
  try {
    return (await chrome.storage.local.get(key))[key];
  } catch {
    return undefined;
  }
}

/** The recorded update, or null when there is none or it is malformed. */
export async function getPendingUpdate(): Promise<PendingUpdate | null> {
  return parsePendingUpdate(await readLocal(UPDATE_AVAILABLE_STORAGE_KEY));
}

/**
 * Records that `version` is downloaded and waiting. Ignored when it is not a version or not newer
 * than the running one. Keeps the first detection time when the same version is reported again.
 */
export async function recordPendingUpdate(version: unknown, now: number = Date.now()): Promise<void> {
  if (!isManifestVersion(version)) return;
  const current = runningVersion();
  if (current && compareVersions(version, current) <= 0) return;
  const existing = await getPendingUpdate();
  if (existing?.version === version) return;
  const value: PendingUpdate = { version, detectedAt: now };
  await chrome.storage.local.set({ [UPDATE_AVAILABLE_STORAGE_KEY]: value });
}

/**
 * Worker start: removes the recorded update (and its dismissal) once the running version is the
 * same or newer, i.e. the update was applied. A malformed value is removed too.
 */
export async function clearAppliedUpdate(): Promise<void> {
  const raw = await readLocal(UPDATE_AVAILABLE_STORAGE_KEY);
  if (raw === undefined) return;
  const pending = parsePendingUpdate(raw);
  const current = runningVersion();
  if (pending && (!current || compareVersions(current, pending.version) < 0)) return;
  await chrome.storage.local.remove(UPDATE_AVAILABLE_STORAGE_KEY);
  await chrome.storage.local.remove(UPDATE_BANNER_DISMISSED_STORAGE_KEY);
}

/** Hides the banner for `version` only: a later update shows it again. */
export async function dismissPendingUpdate(version: string): Promise<void> {
  await chrome.storage.local.set({ [UPDATE_BANNER_DISMISSED_STORAGE_KEY]: version });
}

/** The version whose banner was dismissed, if any. */
export async function getDismissedUpdateVersion(): Promise<string | null> {
  const value = await readLocal(UPDATE_BANNER_DISMISSED_STORAGE_KEY);
  return isManifestVersion(value) ? value : null;
}

/**
 * The update the banner should offer: recorded, newer than the running version and not dismissed.
 */
export async function getVisiblePendingUpdate(): Promise<PendingUpdate | null> {
  const [pending, dismissed] = await Promise.all([getPendingUpdate(), getDismissedUpdateVersion()]);
  if (!pending || dismissed === pending.version) return null;
  const current = runningVersion();
  if (current && compareVersions(pending.version, current) <= 0) return null;
  return pending;
}

/** Applies the downloaded update. Reloads the whole extension, which closes the popup. */
export function restartToUpdate(): void {
  chrome.runtime.reload();
}

/**
 * Background worker: records updates the browser reports, and drops the record once it is
 * applied. Call once from `defineBackground`.
 */
export function registerUpdateAvailable(): void {
  type UpdateEvent = { addListener: (cb: (details?: { version?: unknown }) => void) => void };
  const event = (globalThis.chrome?.runtime as { onUpdateAvailable?: UpdateEvent } | undefined)?.onUpdateAvailable;
  event?.addListener((details) => {
    void recordPendingUpdate(details?.version).catch(() => {});
  });
  void clearAppliedUpdate().catch(() => {});
}

// --- "Check for updates" ---------------------------------------------------------------------

interface RuntimeWithUpdateCheck {
  requestUpdateCheck?: (callback?: (status: unknown, details?: unknown) => void) => unknown;
  lastError?: { message?: string };
}

/** `browser.runtime` on Firefox (promise based), else `chrome.runtime`. */
function updateRuntime(): RuntimeWithUpdateCheck | undefined {
  const browserNs = (globalThis as { browser?: { runtime?: RuntimeWithUpdateCheck } }).browser;
  if (typeof browserNs?.runtime?.requestUpdateCheck === 'function') return browserNs.runtime;
  return globalThis.chrome?.runtime as RuntimeWithUpdateCheck | undefined;
}

/**
 * Whether this browser can be asked to check for an update now. Firefox (desktop and Android)
 * and Safari have no `runtime.requestUpdateCheck`, so Settings shows how the browser updates
 * instead of a button that can only fail. Synchronous, so the UI decides before any click.
 */
export function hasUpdateCheckApi(): boolean {
  return typeof updateRuntime()?.requestUpdateCheck === 'function';
}

/**
 * Turns any of the shapes browsers answer with into one result: Chrome's promise
 * (`{ status, version }`), the callback (`status, { version }`), Firefox's promise
 * (`{ status, details: { version } }`) or an array `[status, details]`.
 */
export function normalizeUpdateCheck(status: unknown, details?: unknown): UpdateCheckResult {
  if (Array.isArray(status)) return normalizeUpdateCheck(status[0], status[1]);
  if (status && typeof status === 'object') {
    const o = status as { status?: unknown; version?: unknown; details?: { version?: unknown } };
    return normalizeUpdateCheck(o.status, { version: o.version ?? o.details?.version });
  }
  const version = (details as { version?: unknown } | undefined)?.version;
  if (status === 'update_available') return isManifestVersion(version) ? { status, version } : { status };
  if (status === 'no_update' || status === 'throttled') return { status };
  return { status: 'error', message: typeof status === 'string' ? status : 'unknown' };
}

/**
 * Whether the browser can update this install at all: development builds, unpacked (Chrome/Edge)
 * and temporary (Firefox) add-ons never get updates.
 */
export async function isUpdatableInstall(): Promise<boolean> {
  if (import.meta.env.MODE === 'development') return false;
  try {
    const management = globalThis.chrome?.management as { getSelf?: () => Promise<{ installType?: string }> } | undefined;
    if (typeof management?.getSelf === 'function') {
      const self = await management.getSelf();
      if (self?.installType === 'development') return false;
    }
  } catch {
    // unknown: let the browser answer
  }
  return true;
}

function callUpdateCheck(runtime: RuntimeWithUpdateCheck): Promise<UpdateCheckResult> {
  const check = runtime.requestUpdateCheck!;
  return new Promise<UpdateCheckResult>((resolve) => {
    let settled = false;
    const done = (r: UpdateCheckResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const callback = (status: unknown, details?: unknown) => {
      const lastError = (globalThis.chrome?.runtime as RuntimeWithUpdateCheck | undefined)?.lastError;
      if (lastError) done({ status: 'error', message: lastError.message ?? 'unknown' });
      else done(normalizeUpdateCheck(status, details));
    };
    let result: unknown;
    try {
      // Promise form first (Chrome MV3, Firefox). A browser without it answers through the callback.
      result = check.call(runtime);
    } catch {
      try {
        check.call(runtime, callback);
      } catch (err) {
        done({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).then(
        (value) => done(normalizeUpdateCheck(value)),
        (err: unknown) => done({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      );
      return;
    }
    // Returned nothing and took no callback: ask again the callback way.
    try {
      check.call(runtime, callback);
    } catch (err) {
      done({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });
}

/**
 * Asks the browser to look for an update now. When one is found it is recorded like an
 * `onUpdateAvailable` event, so the popup banner appears. Never throws. A development install
 * answers `unsupported` before the API is looked at; a browser without the API answers `no_api`.
 */
export async function checkForUpdate(now: number = Date.now()): Promise<UpdateCheckResult> {
  if (!(await isUpdatableInstall())) return { status: 'unsupported' };
  const runtime = updateRuntime();
  if (!runtime || typeof runtime.requestUpdateCheck !== 'function') return { status: 'no_api' };
  const result = await callUpdateCheck(runtime);
  if (result.status === 'update_available' && result.version) {
    await recordPendingUpdate(result.version, now).catch(() => {});
  }
  return result;
}
