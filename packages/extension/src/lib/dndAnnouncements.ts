import type { Announcements, ScreenReaderInstructions } from '@dnd-kit/core';
import { buildDndModel, type DndModel } from '@/hooks/useDndModel';
import { canDrop, type DndLanded, type DndRef, type DndSideEffect } from '@/lib/dndMove';
import { getDndDragCount, getDndDragSelection } from '@/lib/dndMultiDrag';
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types';

/**
 * Screen-reader text for popup drags — real names and positions instead of raw
 * positional ids (`work::w0::t2`).
 *
 * dnd-kit renders these into its own body-level live region (a portal outside `#root`),
 * so updating it mid-drag never touches the drag source's ancestor chain (spec C4).
 *
 * The END announcement can't be derived from the event: by the time dnd-kit announces
 * it, `onDragEnd` has already committed the new state (it runs first, synchronously),
 * so names/positions would read from the wrong state. `onDragEnd` records what happened
 * via {@link setDndDropOutcome}, and the announcement reads it back.
 */

const NEW_WINDOW_SUFFIX = '::new-window';
/** Kept in sync with `NEW_GROUP_ID` in `@/lib/dndMove`. */
const NEW_GROUP_ID = '::new-group';

/** "Command" on macOS, "Control" elsewhere — for spoken shortcut names. */
export function modifierKeyName(): string {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const platform =
    (nav as { userAgentData?: { platform?: string } } | undefined)?.userAgentData?.platform ?? nav?.platform ?? '';
  return /mac/i.test(platform) ? 'Command' : 'Control';
}

/**
 * Kept to TWO sentences on purpose: this is the grip's `aria-describedby`, re-read on every
 * focus — including the focus move right after each keyboard drop. Selection shortcuts
 * (Shift+Space range, Command/Control+A) are announced by the selection bar itself.
 */
export const DND_SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'Press Space to pick up, arrow keys to move, Space to drop, Escape to cancel. ' +
    `Shift+Space selects a range and ${modifierKeyName()}+A selects all, to move several at once.`
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const tabsOf = (w: ExtWindow | undefined): Tab[] => (w?.tabs ?? []).filter(Boolean);
const tabName = (t: Tab | undefined) => t?.customTitle || t?.title || t?.url || 'Untitled tab';
const windowName = (w: ExtWindow | undefined, wi: number) => w?.name || `Window ${wi + 1}`;
const savedGroupCount = (state: GroupsState) => state.available.filter((g) => !g.permanent).length;
/** 1-based sidebar position among saved groups (Now Open, when present, isn't counted). */
const groupPosition = (state: GroupsState, gi: number) =>
  `position ${state.available.some((g) => g.permanent) ? gi : gi + 1} of ${savedGroupCount(state)}`;

export type DndItemType = 'tab' | 'window' | 'group';

export interface DndItemLabel {
  type: DndItemType;
  name: string;
  /** e.g. "position 2 of 5 in Window 1 of group Work" */
  position: string;
  group: Group | undefined;
}

/** Name + position of a model id in `state`, or `null` if it doesn't exist there. */
export function describeItem(state: GroupsState | null | undefined, id: string, model?: DndModel): DndItemLabel | null {
  if (!state) return null;
  const m = model ?? buildDndModel(state);
  const t = m.tabs[id];
  if (t) {
    const g = state.available[t.groupIndex];
    const w = g?.windows[t.windowIndex];
    const tabs = tabsOf(w);
    return {
      type: 'tab',
      name: tabName(tabs[t.tabIndex]),
      position: `position ${t.tabIndex + 1} of ${tabs.length} in ${windowName(w, t.windowIndex)} of group ${g?.name ?? ''}`,
      group: g
    };
  }
  const w = m.windows[id];
  if (w) {
    const g = state.available[w.groupIndex];
    return {
      type: 'window',
      name: windowName(g?.windows[w.windowIndex], w.windowIndex),
      position: `position ${w.windowIndex + 1} of ${g?.windows.length ?? 0} in group ${g?.name ?? ''}`,
      group: g
    };
  }
  const gr = m.groups[id];
  if (gr) {
    const g = state.available[gr.index];
    return { type: 'group', name: g?.name ?? '', position: groupPosition(state, gr.index), group: g };
  }
  return null;
}

/** "tab GitHub" for one item, "3 tabs, starting with GitHub" for a multi-drag. */
function what(label: DndItemLabel, count: number): string {
  return count > 1 ? `${plural(count, label.type)}, starting with ${label.name},` : `${label.type} ${label.name}`;
}

function targetPhrase(state: GroupsState, model: DndModel, activeType: string, overId: string): string | null {
  if (overId === NEW_GROUP_ID) return 'a new group';
  if (overId.endsWith(NEW_WINDOW_SUFFIX)) {
    const g = model.groups[overId.slice(0, -NEW_WINDOW_SUFFIX.length)];
    return g ? `a new window at the end of group ${state.available[g.index]?.name ?? ''}` : null;
  }
  const g = model.groups[overId];
  if (g && activeType !== 'group') {
    const grp = state.available[g.index];
    return grp?.permanent ? 'Now Open, which opens them in a new browser window' : `group ${grp?.name ?? ''}, as a new window`;
  }
  const label = describeItem(state, overId, model);
  return label ? label.position : null;
}

function refFor(model: DndModel, id: string, dataType?: string): DndRef | null {
  if (id === NEW_GROUP_ID) return { type: 'new-group', id };
  if (id.endsWith(NEW_WINDOW_SUFFIX)) {
    const groupId = id.slice(0, -NEW_WINDOW_SUFFIX.length);
    const g = model.groups[groupId];
    return g ? { type: 'new-window', id, groupId, groupIndex: g.index } : null;
  }
  const type = model.tabs[id] ? 'tab' : model.windows[id] ? 'window' : model.groups[id] ? 'group' : dataType;
  return type === 'tab' || type === 'window' || type === 'group' ? { type, id } : null;
}

// ─── drop outcome (written by onDragEnd / onDragCancel, read by the announcement) ────────

let dropOutcome: string | null = null;

export function setDndDropOutcome(text: string): void {
  dropOutcome = text;
}

export function takeDndDropOutcome(): string | null {
  const t = dropOutcome;
  dropOutcome = null;
  return t;
}

/**
 * dnd-kit's own end/cancel text for a KEYBOARD drag. Focus moves to the landed grip right
 * after the drop, and NVDA/JAWS cancel speech on a focus change, so the full outcome is
 * written to the app-owned live region (`@/lib/dndLiveRegion`) once focus has landed.
 */
export const DND_KEYBOARD_DROP_TOKEN = 'Dropped.';
export const DND_KEYBOARD_CANCEL_TOKEN = 'Cancelled.';

// ─── selection remap after a drop (read by SelectionAnnouncer) ──────────────────────
//
// A drop re-points the positional selection at the landed items. The drop outcome already
// says "They're still selected.", so the polite selection region must stay quiet for that
// one store change instead of talking over the assertive outcome.

let dropRemapSig: string | null = null;
const selectionSig = (items: readonly { type: string; id: string }[]) => items.map((s) => `${s.type}:${s.id}`).join('|');

export function noteDropSelectionRemap(items: readonly { type: string; id: string }[]): void {
  dropRemapSig = selectionSig(items);
}

/** True (once) when `items` is the selection a drop just wrote. Any call clears the mark. */
export function consumeDropSelectionRemap(items: readonly { type: string; id: string }[]): boolean {
  const hit = dropRemapSig !== null && dropRemapSig === selectionSig(items);
  dropRemapSig = null;
  return hit;
}

export type DndBailReason = 'noop' | 'rejected' | 'stale' | 'cancelled';

/** Text for a drop that moved nothing. `state` is the drag-start snapshot. */
export function describeDropBail(state: GroupsState | null | undefined, id: string, reason: DndBailReason, count = 1): string {
  const label = describeItem(state, id);
  if (!label) return reason === 'cancelled' ? 'Movement cancelled.' : 'Dropped; nothing moved.';
  const items = count > 1 ? `The ${plural(count, label.type)} returned` : `${capitalize(label.type)} ${label.name} returned`;
  switch (reason) {
    case 'noop':
      return `Dropped ${what(label, count)} back at ${label.position}; nothing moved.`;
    case 'stale':
      return `The groups changed during the drag, so nothing was moved. ${items} to ${label.position}.`;
    case 'cancelled':
      return `Movement cancelled. ${items} to ${label.position}.`;
    default:
      return `Can't drop there. ${items} to ${label.position}.`;
  }
}

/** Text for a committed drop. `before` = the state the move was applied to; `next` = the result. */
export function describeDropCommitted(opts: {
  before: GroupsState;
  next: GroupsState;
  active: DndRef;
  count: number;
  landed?: DndLanded;
  sideEffects: DndSideEffect[];
  activeGroupIndex: number;
  /** selection members deleted elsewhere mid-drag and left out of the move */
  removed?: number;
  /** the moved items are still selected (at their new positions) */
  stillSelected?: boolean;
}): string {
  const text = describeDropCommittedCore(opts);
  const removed = opts.removed ?? 0;
  const parts = [text];
  if (removed > 0) parts.push(`${removed} ${removed === 1 ? 'was' : 'were'} removed elsewhere.`);
  if (opts.stillSelected) parts.push(opts.count > 1 ? "They're still selected." : "It's still selected.");
  return parts.join(' ');
}

function describeDropCommittedCore(opts: Parameters<typeof describeDropCommitted>[0]): string {
  const { before, next, active, count, landed, sideEffects, activeGroupIndex } = opts;
  const removed = opts.removed ?? 0;
  const label = describeItem(before, active.id);
  if (!label) return 'Dropped.';
  if (label.type === 'group') {
    const gi = next.available.findIndex((g) => g.id === active.id);
    // Multi-group drag: the anchor's new slot is where the whole block starts.
    if (count > 1) return `Moved ${count} groups to ${groupPosition(next, gi)}, as one block.`;
    return `Moved group ${label.name} to ${groupPosition(next, gi)}.`;
  }
  const items =
    removed > 0
      ? `${count} of ${plural(count + removed, label.type)}`
      : count > 1
        ? plural(count, label.type)
        : `${label.type} ${label.name}`;
  if (landed && landed.positions.length > 0) {
    const p = landed.positions[0];
    const g = next.available[p.groupIndex];
    const starting = count > 1 ? 'starting at ' : '';
    const where =
      landed.type === 'tab'
        ? `${windowName(g?.windows[p.windowIndex], p.windowIndex)} of group ${g?.name ?? ''}, ${starting}position ${
            (p as { tabIndex: number }).tabIndex + 1
          } of ${tabsOf(g?.windows[p.windowIndex]).length}`
        : `group ${g?.name ?? ''}, ${starting}position ${p.windowIndex + 1} of ${g?.windows.length ?? 0}`;
    // Out of Now Open is a MOVE now, not a copy: the real tabs close (an active one on
    // popup close — spec C7), so say so rather than "the open tabs stay open".
    const fromNowOpen = !!label.group?.permanent;
    const hidden = p.groupIndex !== activeGroupIndex ? ` Group ${g?.name ?? ''} is not shown.` : '';
    return `Moved ${items} to ${where}.${fromNowOpen ? ' The open tabs are closed.' : ''}${hidden}`;
  }
  if (sideEffects.some((fx) => fx.type === 'windows.create')) return `Opened ${items} in a new browser window.`;
  if (sideEffects.some((fx) => fx.type === 'tabs.create')) return `Opened ${items} in Now Open.`;
  return `Moved ${items} within Now Open.`;
}

// ─── the Announcements object ────────────────────────────────────────────────

export function createDndAnnouncements(deps: {
  getState: () => GroupsState | null | undefined;
  getActiveGroupIndex: () => number;
}): Announcements {
  const ORIGINAL_POSITION = 'Over its original position.';
  let lastOver: string | null = null;
  const typeOf = (entry: { data?: { current?: { type?: string } | null } } | null | undefined) =>
    entry?.data?.current?.type ?? 'item';

  return {
    onDragStart({ active }) {
      // dnd-kit fires onDragOver(over = the item itself) right after pickup. Announcing it
      // would REPLACE "Picked up …" in the assertive region before it is read (measured in
      // the real popup), so the first self-over is treated as already announced.
      lastOver = ORIGINAL_POSITION;
      const state = deps.getState();
      const id = String(active.id);
      const label = describeItem(state, id);
      if (!state || !label) return `Picked up ${typeOf(active)}.`;
      const count = getDndDragCount();
      const parts = [
        count > 1 ? `Picked up ${what(label, count).replace(/,$/, '')}.` : `Picked up ${label.type} ${label.name}, ${label.position}.`
      ];
      if (label.type === 'group') {
        const gi = state.available.indexOf(label.group!);
        if (gi > 0 && !label.group?.permanent && gi !== deps.getActiveGroupIndex()) parts.push(`Group ${label.name} is now shown.`);
      } else if (label.group?.permanent) {
        parts.push('Dropping into a saved group copies; the open tabs stay open.');
      }
      return parts.join(' ');
    },

    onDragOver({ active, over }) {
      const state = deps.getState();
      let text: string;
      if (!over || !state) {
        text = 'Not over a drop target.';
      } else {
        const model = buildDndModel(state);
        const a = refFor(model, String(active.id), typeOf(active));
        const o = refFor(model, String(over.id), typeOf(over));
        const phrase = a ? targetPhrase(state, model, a.type, String(over.id)) : null;
        if (!a || !o || !phrase || a.id === o.id) {
          text = a && o && a.id === o.id ? ORIGINAL_POSITION : 'Not over a drop target.';
        } else {
          const selection = getDndDragSelection();
          if (selection) a.selectionIds = [...selection];
          text = canDrop(model, a, o) ? `Over ${phrase}.` : `Can't drop on ${phrase}.`;
        }
      }
      // Announce only when the resolved target actually changes (native drags re-fire this
      // at the dragover rate into an assertive region).
      if (text === lastOver) return undefined;
      lastOver = text;
      return text;
    },

    onDragEnd({ active }) {
      lastOver = null;
      return takeDndDropOutcome() ?? `${capitalize(typeOf(active))} dropped.`;
    },

    onDragCancel({ active }) {
      lastOver = null;
      return takeDndDropOutcome() ?? `Movement cancelled; ${typeOf(active)} returned to its position.`;
    }
  };
}
