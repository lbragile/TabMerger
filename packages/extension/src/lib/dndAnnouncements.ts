import type { Announcements, ScreenReaderInstructions } from '@dnd-kit/core';
import { buildDndModel, type DndModel } from '@/hooks/useDndModel';
import { canDrop, type DndLanded, type DndRef, type DndSideEffect } from '@/lib/dndMove';
import { getDndDragCount, getDndDragSelection } from '@/lib/dndMultiDrag';
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types';
import { t } from '@/lib/i18n';

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
  return /mac/i.test(platform) ? t('dnd.keys.command') : t('dnd.keys.control');
}

/**
 * Kept to TWO sentences on purpose: this is the grip's `aria-describedby`, re-read on every
 * focus — including the focus move right after each keyboard drop. Selection shortcuts
 * (Shift+Space range, Command/Control+A) are announced by the selection bar itself.
 */
export const DND_SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  get draggable() {
    return t('dnd.instructions', { modifier: modifierKeyName() });
  }
};

type CountableType = 'tab' | 'window' | 'group';
const COUNT_KEYS = { tab: 'common.tabCount', window: 'common.windowCount', group: 'common.groupCount' } as const;
const isCountable = (type: string): type is CountableType => type === 'tab' || type === 'window' || type === 'group';

/** "1 tab", "3 windows": a count of one kind of row. */
export const plural = (n: number, type: CountableType) => t(COUNT_KEYS[type], { count: n });
/** The spoken name of a kind of row ("tab"), or "item" for anything else. */
export const typeName = (type: string) => t(isCountable(type) ? `dnd.type.${type}` : 'dnd.type.item');
/** The same, as the first word of a sentence ("Tab"). */
const typeNameStart = (type: string) => t(isCountable(type) ? `dnd.typeStart.${type}` : 'dnd.typeStart.item');
/** "tab GitHub" */
const named = (label: DndItemLabel) => t('dnd.named', { type: typeName(label.type), name: label.name });

const tabsOf = (w: ExtWindow | undefined): Tab[] => (w?.tabs ?? []).filter(Boolean);
const tabName = (tab: Tab | undefined) => tab?.customTitle || tab?.title || tab?.url || t('dnd.untitledTab');
export const windowName = (w: ExtWindow | undefined, wi: number) => w?.name || t('window.numbered', { number: wi + 1 });
const savedGroupCount = (state: GroupsState) => state.available.filter((g) => !g.permanent).length;
/** 1-based sidebar position among saved groups (Now Open, when present, isn't counted). */
const groupPosition = (state: GroupsState, gi: number) =>
  t('dnd.position.group', { index: state.available.some((g) => g.permanent) ? gi : gi + 1, total: savedGroupCount(state) });

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
  const tabRef = m.tabs[id];
  if (tabRef) {
    const g = state.available[tabRef.groupIndex];
    const w = g?.windows[tabRef.windowIndex];
    const tabs = tabsOf(w);
    return {
      type: 'tab',
      name: tabName(tabs[tabRef.tabIndex]),
      position: t('dnd.position.tab', { index: tabRef.tabIndex + 1, total: tabs.length, window: windowName(w, tabRef.windowIndex), group: g?.name ?? '' }),
      group: g
    };
  }
  const w = m.windows[id];
  if (w) {
    const g = state.available[w.groupIndex];
    return {
      type: 'window',
      name: windowName(g?.windows[w.windowIndex], w.windowIndex),
      position: t('dnd.position.window', { index: w.windowIndex + 1, total: g?.windows.length ?? 0, group: g?.name ?? '' }),
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
export function what(label: DndItemLabel, count: number): string {
  return count > 1 ? t('dnd.whatMany', { items: plural(count, label.type), name: label.name }) : named(label);
}

export function targetPhrase(state: GroupsState, model: DndModel, activeType: string, overId: string): string | null {
  if (overId === NEW_GROUP_ID) return t('dnd.target.newGroup');
  if (overId.endsWith(NEW_WINDOW_SUFFIX)) {
    const g = model.groups[overId.slice(0, -NEW_WINDOW_SUFFIX.length)];
    return g ? t('dnd.target.newWindowAtEnd', { group: state.available[g.index]?.name ?? '' }) : null;
  }
  const g = model.groups[overId];
  if (g && activeType !== 'group') {
    const grp = state.available[g.index];
    return grp?.permanent ? t('dnd.target.nowOpen') : t('dnd.target.groupAsWindow', { group: grp?.name ?? '' });
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
export const dndKeyboardDropToken = (): string => t('dnd.token.dropped');
export const dndKeyboardCancelToken = (): string => t('dnd.token.cancelled');

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
  if (!label) return reason === 'cancelled' ? t('dnd.bail.cancelled') : t('dnd.bail.nothingMoved');
  const returned = count > 1
    ? t('dnd.bail.returnedMany', { items: plural(count, label.type) })
    : t('dnd.bail.returnedOne', { named: t('dnd.namedStart', { type: typeNameStart(label.type), name: label.name }) });
  const position = label.position;
  switch (reason) {
    case 'noop':
      return t('dnd.bail.noop', { what: what(label, count), position });
    case 'stale':
      return t('dnd.bail.stale', { returned, position });
    case 'cancelled':
      return t('dnd.bail.cancelledReturned', { returned, position });
    default:
      return t('dnd.bail.rejected', { returned, position });
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
  if (removed > 0) parts.push(t('dnd.removedElsewhere', { count: removed }));
  if (opts.stillSelected) parts.push(t('dnd.stillSelected', { count: opts.count > 1 ? opts.count : 1 }));
  return parts.join(' ');
}

function describeDropCommittedCore(opts: Parameters<typeof describeDropCommitted>[0]): string {
  const { before, next, active, count, landed, sideEffects, activeGroupIndex } = opts;
  const removed = opts.removed ?? 0;
  const label = describeItem(before, active.id);
  if (!label) return t('dnd.dropped');
  if (label.type === 'group') {
    const gi = next.available.findIndex((g) => g.id === active.id);
    // Multi-group drag: the anchor's new slot is where the whole block starts.
    if (count > 1) return t('dnd.movedGroups', { count, position: groupPosition(next, gi) });
    return t('dnd.movedGroup', { name: label.name, position: groupPosition(next, gi) });
  }
  const items =
    removed > 0
      ? t('dnd.partial', { count, total: plural(count + removed, label.type) })
      : count > 1
        ? plural(count, label.type)
        : named(label);
  if (landed && landed.positions.length > 0) {
    const p = landed.positions[0];
    const g = next.available[p.groupIndex];
    const atKey = count > 1 ? 'dnd.startingAt' : 'dnd.at';
    const where =
      landed.type === 'tab'
        ? t('dnd.whereTab', {
            window: windowName(g?.windows[p.windowIndex], p.windowIndex),
            group: g?.name ?? '',
            at: t(atKey, { index: (p as { tabIndex: number }).tabIndex + 1, total: tabsOf(g?.windows[p.windowIndex]).length })
          })
        : t('dnd.whereWindow', { group: g?.name ?? '', at: t(atKey, { index: p.windowIndex + 1, total: g?.windows.length ?? 0 }) });
    // Out of Now Open is a MOVE now, not a copy: the real tabs close (an active one on
    // popup close — spec C7), so say so rather than "the open tabs stay open".
    const fromNowOpen = !!label.group?.permanent;
    const hidden = p.groupIndex !== activeGroupIndex ? t('dnd.groupHidden', { group: g?.name ?? '' }) : '';
    return `${t('dnd.movedTo', { items, where })}${fromNowOpen ? t('dnd.openTabsClosed') : ''}${hidden}`;
  }
  if (sideEffects.some((fx) => fx.type === 'windows.create')) return t('dnd.openedNewWindow', { items });
  if (sideEffects.some((fx) => fx.type === 'tabs.create')) return t('dnd.openedNowOpen', { items });
  if (sideEffects.some((fx) => fx.type === 'tabs.detachToNewWindow')) return t('dnd.movedNewWindow', { items });
  return t('dnd.movedWithinNowOpen', { items });
}

// ─── the Announcements object ────────────────────────────────────────────────

export function createDndAnnouncements(deps: {
  getState: () => GroupsState | null | undefined;
  getActiveGroupIndex: () => number;
}): Announcements {
  const ORIGINAL_POSITION = t('dnd.originalPosition');
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
      if (!state || !label) return t('dnd.pickedUpType', { type: typeName(typeOf(active)) });
      const count = getDndDragCount();
      const parts = [
        count > 1
          ? t('dnd.pickedUpMany', { what: what(label, count).replace(/,$/, '') })
          : t('dnd.pickedUpOne', { type: typeName(label.type), name: label.name, position: label.position })
      ];
      if (label.type === 'group') {
        const gi = state.available.indexOf(label.group!);
        if (gi > 0 && !label.group?.permanent && gi !== deps.getActiveGroupIndex()) parts.push(t('dnd.groupShown', { name: label.name }));
      } else if (label.group?.permanent) {
        parts.push(t('dnd.copyHint'));
      }
      return parts.join(' ');
    },

    onDragOver({ active, over }) {
      const state = deps.getState();
      let text: string;
      if (!over || !state) {
        text = t('dnd.notOver');
      } else {
        const model = buildDndModel(state);
        const a = refFor(model, String(active.id), typeOf(active));
        const o = refFor(model, String(over.id), typeOf(over));
        const phrase = a ? targetPhrase(state, model, a.type, String(over.id)) : null;
        if (!a || !o || !phrase || a.id === o.id) {
          text = a && o && a.id === o.id ? ORIGINAL_POSITION : t('dnd.notOver');
        } else {
          const selection = getDndDragSelection();
          if (selection) a.selectionIds = [...selection];
          text = canDrop(model, a, o) ? t('dnd.over', { target: phrase }) : t('dnd.cantDropOn', { target: phrase });
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
      return takeDndDropOutcome() ?? t('dnd.typeDropped', { type: typeNameStart(typeOf(active)) });
    },

    onDragCancel({ active }) {
      lastOver = null;
      return takeDndDropOutcome() ?? t('dnd.cancelledReturnedType', { type: typeName(typeOf(active)) });
    }
  };
}
