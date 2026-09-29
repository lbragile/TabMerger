import type { DeviceSession } from '@tabmerger/shared';
import { encryptBlob, decryptBlob, isEncryptedBlob, type EncryptedBlob } from '@tabmerger/shared';
import type { GroupsState, Tier } from './types';
import { getSetting, setSetting } from './localDb';
import { supabase } from './supabase';
import { hasEncryptionKey, getDataKey } from './encryptionKey';
import { canUploadOnFirefox } from './syncEngine';

/** Rapid Now Open changes (tab open/close bursts) coalesce into a single push after this window. */
export const DEVICE_SESSION_DEBOUNCE_MS = 2000;

const STALE_DEVICE_DAYS = 30;

// keyed per signed-in user — see generateAndPersistDeviceId for why.
let pending: Promise<string> | null = null;
let pendingForUserId: string | undefined;

async function generateAndPersistDeviceId(settingKey: string): Promise<string> {
  const existing = await getSetting<string | undefined>(settingKey, undefined);
  if (existing) return existing;

  const id = crypto.randomUUID();
  await setSetting(settingKey, id);
  return id;
}

/**
 * Returns this (browser, signed-in account) pair's persisted UUID, generating and storing one on
 * first call. Idempotent per user. Scoped by `deviceId:${userId}` — a single unscoped key
 * previously made every account signed into the same browser profile report the SAME device_id,
 * which is cosmetically wrong (RLS already isolates device_sessions rows per user, so this was
 * never a data leak, just an identity mixup). Falls back to an unscoped key pre-auth (rare: only
 * reachable if a caller invokes this before checking for a session).
 * Concurrent cold-cache callers (e.g. useCurrentTabs + OtherDevices on mount) for the SAME user
 * share one in-flight generate+persist instead of racing separate crypto.randomUUID() writes.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  const settingKey = session ? `deviceId:${session.user.id}` : 'deviceId';

  if (!pending || pendingForUserId !== session?.user.id) {
    pendingForUserId = session?.user.id;
    pending = generateAndPersistDeviceId(settingKey).finally(() => {
      pending = null;
    });
  }
  return pending;
}

/** Parses a simple "Browser on OS" label from a userAgent string, e.g. "Chrome on Windows". */
export function getDeviceName(userAgent: string): string {
  const browserMatch = userAgent.match(/(Chrome|Firefox|Edg|Safari)\/[\d.]+/);
  const browser = browserMatch ? (browserMatch[1] === 'Edg' ? 'Edge' : browserMatch[1]) : null;

  let os: string | null = null;
  if (/Windows/.test(userAgent)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(userAgent)) os = 'Mac';
  else if (/Linux/.test(userAgent)) os = 'Linux';
  else if (/Android/.test(userAgent)) os = 'Android';

  if (!browser || !os) return 'Unknown device';
  return `${browser} on ${os}`;
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let latestState: GroupsState | undefined;
let latestTier: Tier = 'pro';

async function doPush(): Promise<void> {
  const state = latestState;
  const tier = latestTier;
  debounceTimer = undefined;
  latestState = undefined;
  if (!state || tier === 'free') return;

  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session) return;
  if (!(await canUploadOnFirefox())) return; // see syncEngine.ts's canUploadOnFirefox doc comment

  const deviceId = await getOrCreateDeviceId();
  const deviceName = getDeviceName(navigator.userAgent);
  const nowOpen = state.available.find((g) => g.permanent);

  let snapshotField: { windows: GroupsState['available'][number]['windows'] } | EncryptedBlob = {
    windows: nowOpen?.windows ?? []
  };

  if (await hasEncryptionKey()) {
    const dataKey = await getDataKey();
    if (!dataKey) {
      // ponytail: locked — never push a plaintext Now Open snapshot. Skip this push,
      // it'll retry on the next debounced tab-change once unlocked (same as pushGroup).
      console.warn('[deviceSessions] Encryption enabled but key is locked — skipping device session push');
      return;
    }
    const { iv, ct } = await encryptBlob(dataKey, snapshotField);
    snapshotField = { v: 1, iv, ct };
  }

  const { error } = await supabase.from('device_sessions').upsert({
    user_id: session.user.id,
    device_id: deviceId,
    device_name: deviceName,
    now_open_snapshot: snapshotField,
    last_active: new Date().toISOString()
  }, { onConflict: 'user_id,device_id' });

  // ponytail: failed push is silently dropped, no retry queue (unlike syncEngine.ts pendingSync) — acceptable, this is
  // best-effort presence data, not sync-critical; upgrade path: persist a pending flag and retry on next tab event.
  if (error) console.error('[deviceSessions] Failed to push device session', error.message);
}

/**
 * Debounced push of the current device's Now Open snapshot to Supabase.
 * No-op for free tier (checked at push time, not schedule time, so the debounce still coalesces).
 * Call on every Now Open change; rapid calls within `DEVICE_SESSION_DEBOUNCE_MS` collapse into one push.
 */
export function pushDeviceSession(state: GroupsState, tier: Tier = 'pro'): void {
  // ponytail: if the popup closes within the debounce window the pending push is lost (MV3 popups are torn down on
  // close) until the next tab-change event — acceptable, best-effort presence; upgrade path: move debounce/push to
  // the background service worker if staleness becomes a real complaint.
  latestState = state;
  latestTier = tier;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void doPush(), DEVICE_SESSION_DEBOUNCE_MS);
}

/** Keeps only the first row per device_name — call on a list already ordered by last_active desc. */
export function dedupeByDeviceName<T extends { device_name: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.device_name)) return false;
    seen.add(row.device_name);
    return true;
  });
}

/** Fetches all of this account's devices (including this one), active within the last 30 days. No-op for free tier. */
export async function fetchDeviceSessions(tier: Tier): Promise<DeviceSession[]> {
  if (tier === 'free') return [];

  const cutoff = new Date(Date.now() - STALE_DEVICE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('device_sessions')
    .select('*')
    .gte('last_active', cutoff)
    .order('last_active', { ascending: false });

  if (error || !data) {
    if (error) console.error('[deviceSessions] Failed to fetch devices', error.message);
    return [];
  }

  const decoded = await Promise.all((data as DeviceSession[]).map(async (row) => {
    if (!isEncryptedBlob(row.now_open_snapshot)) return row;
    const dataKey = await getDataKey();
    if (!dataKey) return { ...row, now_open_snapshot: null }; // locked — degrade to "no snapshot", same as a malformed row
    try {
      const content = await decryptBlob<{ windows: unknown }>(dataKey, row.now_open_snapshot);
      return { ...row, now_open_snapshot: content };
    } catch {
      return { ...row, now_open_snapshot: null };
    }
  }));

  // Same device can end up with more than one device_id row (e.g. extension storage
  // cleared/reinstalled regenerates a fresh UUID). Rows are already ordered by
  // last_active desc, so keeping the first occurrence per device_name keeps the
  // most recent row and drops older duplicates of the same physical device.
  const deduped = dedupeByDeviceName(decoded);

  // ponytail: dev-only mock data — only fires in `pnpm dev:extension` (import.meta.env.DEV is
  // compiled to `false` and dead-code-eliminated by Vite in production builds). Appended
  // alongside real rows (not just as an empty-state fallback) so the Other Devices UI can be
  // visually verified with a mix of real + mock devices during development.
  // Delete this block once no longer needed.
  if (import.meta.env.DEV) {
    return [...deduped, ...getMockDeviceSessions()];
  }

  return deduped;
}

// ponytail: dev-only mock data, see call site above. Not a real DeviceSession[] source — never
// imported outside this file.
function getMockDeviceSessions(): DeviceSession[] {
  const now = Date.now();
  // note: OtherDevices.tsx expects an `id` field alongside DeviceSession (Supabase row pk), see its
  // local DeviceSessionRow type — included here even though it's not on the shared DeviceSession type.
  return [
    {
      id: 'mock-device-1',
      device_id: 'mock-device-1',
      device_name: 'Chrome on Mac',
      last_active: new Date(now - 5 * 60 * 1000).toISOString(),
      now_open_snapshot: {
        windows: [
          {
            tabs: [
              { title: 'GitHub - TabMerger', url: 'https://github.com/example/tabmerger' },
              { title: 'Supabase Dashboard', url: 'https://supabase.com/dashboard' }
            ]
          }
        ]
      }
    },
    {
      id: 'mock-device-2',
      device_id: 'mock-device-2',
      device_name: 'Firefox on Windows',
      last_active: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      now_open_snapshot: {
        windows: [{ tabs: [{ title: 'MDN Web Docs', url: 'https://developer.mozilla.org' }] }]
      }
    },
    {
      id: 'mock-device-3',
      device_id: 'mock-device-3',
      device_name: 'Edge on Windows',
      last_active: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      now_open_snapshot: { windows: [] }
    }
  ] as unknown as DeviceSession[];
}

/** Removes device_sessions rows by id — RLS scopes deletes to the owning user, filtered explicitly too. */
export async function removeDevices(deviceIds: string[]): Promise<void> {
  if (deviceIds.length === 0) return;
  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session) return;

  const { error } = await supabase
    .from('device_sessions')
    .delete()
    .in('id', deviceIds)
    .eq('user_id', session.user.id);
  if (error) console.error('[deviceSessions] Failed to remove devices', error.message);
}

/** Renames this device — updates device_name for own device_id only. */
export async function renameDevice(newName: string): Promise<void> {
  const ownDeviceId = await getOrCreateDeviceId();
  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session) return;

  // defense-in-depth: RLS already scopes updates to the owning user, but filter explicitly too.
  const { error } = await supabase
    .from('device_sessions')
    .update({ device_name: newName })
    .eq('device_id', ownDeviceId)
    .eq('user_id', session.user.id);
  if (error) console.error('[deviceSessions] Failed to rename device', error.message);
}
