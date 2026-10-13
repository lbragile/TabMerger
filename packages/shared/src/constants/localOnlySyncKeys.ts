/**
 * One device's own sync bookkeeping on a group. It means nothing outside that device, so it is
 * left out of every backup FILE: the ones the extension writes ("Also save a file to this
 * computer") and the ones the web dashboard offers for download.
 */
export const LOCAL_ONLY_SYNC_KEYS: readonly string[] = ['pendingSync', 'positionDirty', 'remoteUpdatedAt'];

/** Group > windows > window > tabs > tab > a tab's own objects is 6 levels; anything deeper is not ours. */
export const LOCAL_ONLY_STRIP_MAX_DEPTH = 8;

/**
 * A copy of `value` without {@link LOCAL_ONLY_SYNC_KEYS}, wherever they are (group, window, tab or
 * below). The input is not changed. Content nested deeper than the extension ever writes is left
 * out, so the walk is bounded for any content.
 */
export function withoutLocalOnlySyncKeys(value: unknown, depth = 0): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= LOCAL_ONLY_STRIP_MAX_DEPTH) return Array.isArray(value) ? [] : {};
  if (Array.isArray(value)) return value.map((entry) => withoutLocalOnlySyncKeys(entry, depth + 1));
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (LOCAL_ONLY_SYNC_KEYS.includes(key)) continue;
    copy[key] = withoutLocalOnlySyncKeys(entry, depth + 1);
  }
  return copy;
}
