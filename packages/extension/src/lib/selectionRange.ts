import type { GroupsState } from '@/lib/types';
import type { SelectedItem } from '@/stores/uiStore';

/**
 * Shift+click range for the popup selection (legacy positional ids `tab-{gi}-{wi}-{ti}`,
 * `window-{gi}-{wi}`, `group-{gi}`).
 *
 * TABS / WINDOWS: the range is every item of the SAME type from `anchor` to `target`
 * inclusive, in the windows panel's visual order — so a TAB range may span windows (top
 * window's tabs first), but never groups: only one group's panel is visible at a time,
 * and a range the user can't see would be a surprise.
 *
 * GROUPS: the range runs down the SIDEBAR list instead, over `state.available` order, and
 * ALWAYS excludes the permanent "Now Open" group — it can't be dragged, deleted or
 * reordered, so putting it in a selection would only produce a selection whose every
 * action is rejected. Archived groups are excluded for the same reason (they aren't
 * rendered in the sortable list).
 *
 * Returns `[]` when there is no usable anchor (none, another type, another group, or no
 * longer present) — the caller then selects just the target.
 */
const LEGACY = /^(tab|window|group)-(\d+)(?:-(\d+))?(?:-(\d+))?$/;

export function selectionRange(
  state: GroupsState | undefined,
  anchor: SelectedItem | null | undefined,
  target: SelectedItem
): SelectedItem[] {
  if (!state || !anchor || anchor.type !== target.type) return [];
  if (target.type !== 'tab' && target.type !== 'window' && target.type !== 'group') return [];
  const a = LEGACY.exec(anchor.id);
  const t = LEGACY.exec(target.id);
  if (!a || !t) return [];

  if (target.type === 'group') {
    // Sidebar order, minus Now Open and archived rows (neither is a drag/selection target).
    const ordered: SelectedItem[] = state.available.flatMap((g, gi) =>
      g.permanent || g.archived ? [] : [{ type: 'group' as const, id: `group-${gi}` }]
    );
    return slice(ordered, anchor.id, target.id);
  }

  // Tabs / windows: both ends must be in the SAME group.
  if (a[2] !== t[2]) return [];
  const gi = Number(t[2]);
  const group = state.available[gi];
  if (!group) return [];

  const ordered: SelectedItem[] = [];
  group.windows.forEach((w, wi) => {
    if (target.type === 'window') ordered.push({ type: 'window', id: `window-${gi}-${wi}` });
    else w.tabs.forEach((_t, ti) => ordered.push({ type: 'tab', id: `tab-${gi}-${wi}-${ti}` }));
  });
  return slice(ordered, anchor.id, target.id);
}

/** Inclusive slice of `ordered` between two ids, in either direction. */
function slice(ordered: SelectedItem[], anchorId: string, targetId: string): SelectedItem[] {
  const from = ordered.findIndex((s) => s.id === anchorId);
  const to = ordered.findIndex((s) => s.id === targetId);
  if (from < 0 || to < 0) return [];
  return ordered.slice(Math.min(from, to), Math.max(from, to) + 1);
}
