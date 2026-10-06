import type { Group, GroupsState } from './types';

const aborted = new WeakSet<object>();

/** Marks the state a mutation resolved with as "did nothing" (its target was gone). */
export function markAborted(state: object): void {
  aborted.add(state);
}

/** True for a state resolved by a mutation that did nothing; `onSuccess` analytics should skip it. */
export function wasAborted(state: unknown): boolean {
  return typeof state === 'object' && state !== null && aborted.has(state);
}

/**
 * Re-addresses a fresh groups state to the list the user was LOOKING at.
 *
 * Mutators take a positional group index from the render the click belongs to, but run on a
 * fresh read, and the list can have changed in between (a sync reorder, a group saved by the
 * service worker): the index would then point at a different group. Aligning the fresh state
 * to `base` (the cache at call time) by group ID keeps every base index meaning the same group.
 * Groups that appeared since go to the end. Returns `fresh` untouched when the order already
 * matches, and `null` when a group the user was looking at is gone (nothing safe to mutate).
 */
export function alignToBase(base: GroupsState | undefined, fresh: GroupsState): GroupsState | null {
  if (!base) return fresh;
  const same = base.available.length === fresh.available.length && base.available.every((g, i) => g.id === fresh.available[i].id);
  if (same) return fresh;
  const byId = new Map(fresh.available.map((g) => [g.id, g]));
  const aligned = base.available.map((g) => byId.get(g.id));
  if (aligned.some((g) => !g)) return null;
  const baseIds = new Set(base.available.map((g) => g.id));
  return { ...fresh, available: [...(aligned as Group[]), ...fresh.available.filter((g) => !baseIds.has(g.id))] };
}

/**
 * Maps a mutation done on the base-ordered view (`aligned`) back onto the FRESH order. Writing
 * the view as is would put the base order back and, through the derived positions, push a stale
 * order over a reorder that was just pulled. Keeps the fresh order for surviving groups (taking
 * each one's updated version by id), drops removed groups and slots new ones after their
 * predecessor in `result`. If the mutation itself reordered the survivors (a user reorder) its
 * own order is the intent and `result` is returned unchanged.
 */
export function restoreFreshOrder(fresh: GroupsState, aligned: GroupsState, result: GroupsState): GroupsState {
  const alignedIds = aligned.available.map((g) => g.id);
  const resultIds = result.available.map((g) => g.id);
  const survivors = resultIds.filter((id) => alignedIds.includes(id));
  const expected = alignedIds.filter((id) => resultIds.includes(id));
  if (survivors.some((id, i) => id !== expected[i])) return result;

  const resultById = new Map(result.available.map((g) => [g.id, g]));
  const freshIds = new Set(fresh.available.map((g) => g.id));
  const out: Group[] = [];
  for (const g of fresh.available) {
    const updated = resultById.get(g.id);
    if (updated) out.push(updated);
  }
  result.available.forEach((g, i) => {
    if (freshIds.has(g.id)) return;
    const prevId = result.available[i - 1]?.id;
    const at = prevId ? out.findIndex((x) => x.id === prevId) : -1;
    out.splice(at + 1, 0, g);
  });
  return { ...result, available: out };
}
