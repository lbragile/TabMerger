import { nanoid } from 'nanoid';
import { CONFLICT_COPY_SUFFIX } from '@tabmerger/shared';
import type { Group } from './types';

/** JSON with sorted keys: jsonb (the server) does not keep key order, so plain stringify is not comparable. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * True when two copies of a group have the same synced CONTENT: name, color, windows/tabs, starred,
 * archived, note, info. Ignores everything that is bookkeeping (updatedAt, pendingSync, positionDirty,
 * remoteUpdatedAt) and position. Also what makes a conflict that is only a server-side `updated_at`
 * bump (a reorder elsewhere before migration 020) resolve silently instead of creating a copy.
 */
export function groupContentEqual(a: Group, b: Group): boolean {
  const content = (g: Group) => ({
    name: g.name,
    color: g.color,
    windows: g.windows,
    starred: g.starred ?? false,
    archived: g.archived ?? false,
    note: g.note ?? '',
    info: g.info ?? ''
  });
  return stableStringify(content(a)) === stableStringify(content(b));
}

/** "<name> (conflict copy)"; a name that already carries the suffix is not stacked. */
export function conflictCopyName(name: string): string {
  return name.endsWith(CONFLICT_COPY_SUFFIX) ? name : `${name}${CONFLICT_COPY_SUFFIX}`;
}

/**
 * This device's edit saved as a NEW group: new id, suffixed name, pending, no server base. It is
 * inserted (never a compare-and-swap) on the next push.
 */
export function makeConflictCopy(local: Group): Group {
  const { remoteUpdatedAt: _base, positionDirty: _dirty, ...rest } = local;
  return { ...rest, id: nanoid(10), name: conflictCopyName(local.name), updatedAt: Date.now(), pendingSync: true };
}
