import { AUTO_SAVE_FREE_KEEP_COUNT } from '@tabmerger/shared';
import type { Group } from './types';

/**
 * Pure helpers for groups made by "Auto-save open tabs" (see `Group.autoSave`). Store-free and
 * React-free on purpose: `localDb` (every write), `syncEngine` (the background worker too) and the
 * popup all use them.
 */

type AutoSaveMarker = NonNullable<Group['autoSave']>;

/** The marker when it has exactly the expected shape (read from storage or a decrypted row), otherwise `undefined`. */
export function parseAutoSaveMarker(raw: unknown): AutoSaveMarker | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.at !== 'number' || !Number.isFinite(r.at) || r.at <= 0) return undefined;
  if (typeof r.rolling !== 'boolean') return undefined;
  return { at: r.at, rolling: r.rolling };
}

/** A group the extension saved by itself and the user has not kept or edited yet. Never "Now Open". */
export function isAutoSavedGroup(g: Pick<Group, 'autoSave' | 'permanent'> | null | undefined): boolean {
  return !!g && !g.permanent && !!parseAutoSaveMarker(g.autoSave);
}

/** One that a later auto-save made on Free may replace. */
export function isRollingAutoSave(g: Pick<Group, 'autoSave' | 'permanent'>): boolean {
  return isAutoSavedGroup(g) && g.autoSave!.rolling === true;
}

/**
 * The auto-saved groups of a state with their index in `available`, newest first (ties: the later
 * one in the list first).
 */
export function listAutoSavedGroups(available: Group[]): { group: Group; realIndex: number }[] {
  return available
    .map((group, realIndex) => ({ group, realIndex }))
    .filter(({ group }) => isAutoSavedGroup(group))
    .sort((a, b) => b.group.autoSave!.at - a.group.autoSave!.at || b.realIndex - a.realIndex);
}

/**
 * The rolling auto-saves the NEXT auto-save on Free replaces: the oldest ones beyond the newest
 * `keep - 1` (so after it the newest `keep` remain). Empty while fewer than `keep` exist.
 */
export function rollingToReplace(available: Group[], keep: number = AUTO_SAVE_FREE_KEEP_COUNT): Group[] {
  const rolling = available.filter(isRollingAutoSave).sort((a, b) => a.autoSave!.at - b.autoSave!.at);
  const excess = rolling.length - Math.max(0, keep - 1);
  return excess > 0 ? rolling.slice(0, excess) : [];
}

/** JSON with object keys sorted, so equal content always serialises the same way. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * A group's content as the user sees it, normalised like `groupContentEqual` (a pulled copy has
 * `starred: false` / `archived: false` / no `permanent` where the local one may have the keys
 * missing): sync bookkeeping, the derived count line and the marker itself are left out.
 */
function userContentKey(g: Group): string {
  return stableStringify({
    name: g.name,
    color: g.color,
    windows: g.windows,
    starred: g.starred ?? false,
    archived: g.archived ?? false,
    note: g.note ?? ''
  });
}

/**
 * "Editing an auto-saved group keeps it": `next` is what a write is about to store for a group
 * whose stored copy is `stored`. When both still carry the marker but the user's content changed
 * (rename, colour, note, star, archive, a tab or window added, removed, moved or edited) in a write
 * that marks it for sync (every user edit does; a pulled server copy does not), the
 * marker is dropped and the group becomes a normal group that is never replaced. Returns the
 * group to store instead, or `null` when nothing applies (the common case, cheap: no stored
 * marker, no new marker, or `next` IS the stored object).
 *
 * Opening tabs from a group writes nothing, so it never counts. Undo restoring an auto-saved group
 * is not affected: the stored copy (the edited one) has no marker by then.
 */
export function promoteEditedAutoSave(stored: Group | undefined, next: Group): Group | null {
  if (!stored || stored === next || next.permanent) return null;
  // Every user edit marks the group for sync; a pulled server copy (pendingSync false) is never an
  // edit made here, whatever its shape
  if (next.pendingSync !== true) return null;
  if (!parseAutoSaveMarker(stored.autoSave) || !next.autoSave) return null;
  if (userContentKey(stored) === userContentKey(next)) return null;
  const { autoSave: _marker, ...rest } = next;
  return { ...rest, updatedAt: Math.max(Date.now(), next.updatedAt), pendingSync: true };
}

/** Drops the marker on purpose ("Keep as group"). */
export function keepAutoSavedGroup(g: Group, now: number = Date.now()): Group {
  const { autoSave: _marker, ...rest } = g;
  return { ...rest, updatedAt: Math.max(now, g.updatedAt), pendingSync: true };
}

type PromotedListener = (groups: Group[]) => void;
const promotedListeners = new Set<PromotedListener>();

/**
 * Tells this context's listeners which auto-saved groups a write just turned into normal groups
 * (see {@link promoteEditedAutoSave}). The popup shows "Moved to your groups" with Undo; the
 * background worker has no listener.
 */
export function onAutoSavePromoted(listener: PromotedListener): () => void {
  promotedListeners.add(listener);
  return () => promotedListeners.delete(listener);
}

export function emitAutoSavePromoted(groups: Group[]): void {
  if (groups.length === 0) return;
  for (const listener of promotedListeners) {
    try {
      listener(groups);
    } catch (err) {
      console.error('[autoSave] promoted listener failed', err);
    }
  }
}
