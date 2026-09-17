import type { GroupsState } from '@/lib/types';
import type { SelectedItem } from '@/stores/uiStore';

/**
 * Shift+click range for the popup selection (legacy positional ids `tab-{gi}-{wi}-{ti}`,
 * `window-{gi}-{wi}`).
 *
 * The range is every item of the SAME type from `anchor` to `target` inclusive, in the
 * windows panel's visual order — so a TAB range may span windows (top window's tabs
 * first), but never groups: only one group's panel is visible at a time, and a range
 * the user can't see would be a surprise. Returns `[]` when there is no usable anchor
 * (none, another type, another group, or no longer present) — the caller then selects
 * just the target.
 */
const LEGACY = /^(tab|window)-(\d+)-(\d+)(?:-(\d+))?$/;

export function selectionRange(
  state: GroupsState | undefined,
  anchor: SelectedItem | null | undefined,
  target: SelectedItem
): SelectedItem[] {
  if (!state || !anchor || anchor.type !== target.type) return [];
  if (target.type !== 'tab' && target.type !== 'window') return [];
  const a = LEGACY.exec(anchor.id);
  const t = LEGACY.exec(target.id);
  if (!a || !t || a[2] !== t[2]) return [];
  const gi = Number(t[2]);
  const group = state.available[gi];
  if (!group) return [];

  const ordered: SelectedItem[] = [];
  group.windows.forEach((w, wi) => {
    if (target.type === 'window') ordered.push({ type: 'window', id: `window-${gi}-${wi}` });
    else w.tabs.forEach((_t, ti) => ordered.push({ type: 'tab', id: `tab-${gi}-${wi}-${ti}` }));
  });
  const from = ordered.findIndex((s) => s.id === anchor.id);
  const to = ordered.findIndex((s) => s.id === target.id);
  if (from < 0 || to < 0) return [];
  return ordered.slice(Math.min(from, to), Math.max(from, to) + 1);
}
