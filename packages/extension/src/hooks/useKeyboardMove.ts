import { useEffect, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { buildDndModel } from '@/hooks/useDndModel';
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups';
import { getNewGroupZoneGate, ownFocusSelectors, promoteStoreSelection } from '@/hooks/useDndHandlers';
import { useDndContext } from '@/components/dnd/DndProvider';
import { announceDnd } from '@/lib/dndLiveRegion';
import { describeDropBail } from '@/lib/dndAnnouncements';
import { dndDebugLog } from '@/lib/dndDebug';
import { focusFirst } from '@/lib/dndFocus';
import { measureRows, collapseRows, type CollapseHandle } from '@/lib/dndDragVisuals';
import { holdInstantFrames } from '@/lib/dndHtml5Sensor';
import { makeGap } from '@/lib/dndInsertion';
import { NEW_GROUP_ID, type DndRef } from '@/lib/dndMove';
import { clearDndDragLive, setDndDragLive } from '@/lib/dndMultiDrag';
import { rebaseMove } from '@/lib/dndRebase';
import { motionScrollBehavior } from '@/lib/reducedMotion';
import {
  activeRefFor,
  currentTarget,
  describeGroupEntry,
  describeListStop,
  describePickup,
  describeWrap,
  enterGroup,
  enterList,
  enterListScope,
  listNeighbor,
  listStops,
  rebuildMove,
  startMove,
  stepMove,
  wouldWrap,
  type MoveDirection,
  type MoveKind,
  type MoveOptions,
  type MoveScope,
  type MoveSource,
  type MoveState,
  type MoveTarget
} from '@/lib/keyboardMove';
import { createMoveGhost, type MoveGhost } from '@/lib/keyboardMoveGhost';
import { anchorFor, clampToVisible, dockRectFor, markerElement, revealSpan, rowFor } from '@/lib/keyboardMoveDom';
import { useKeyboardMoveStore } from '@/stores/keyboardMoveStore';
import { useUIStore } from '@/stores/uiStore';
import type { GroupsState } from '@/lib/types';

const isRendered = (id: string) => rowFor(id) !== null;

export { markerElement };

/** Frames the docked ghost keeps re-measuring after a target change (the rows animate for ~200ms). */
const GHOST_FOLLOW_FRAMES = 24;

/** Spoken when the groups changed and the picked-up item(s) can no longer be identified in them. */
const GROUPS_CHANGED_TEXT = 'The groups changed, so the movement was cancelled.';

/**
 * The target handed to `rebaseMove` when only the picked-up SOURCE is re-anchored (the
 * targets are rebuilt around it afterwards): the "new group" zone names no existing item,
 * so it resolves against any groups state.
 */
const ANY_STATE_TARGET: DndRef = { type: 'new-group', id: NEW_GROUP_ID };

interface Live {
  ms: MoveState;
  origin: HTMLElement | null;
  dispose: (restoreShown?: boolean) => void;
}

/**
 * Keyboard MOVE MODE controller. Mounted once inside `<DndProvider>` (by `KeyboardMoveHost`,
 * which passes the stable focusable element that owns focus during a move).
 *
 * A row's Space handler calls `useKeyboardMoveStore.requestMove`; this hook then owns the
 * whole move:
 *  - a document-level capture keydown handler (Up/Down walk the shown group's targets and
 *    wrap; Left moves the item to the sidebar's group list, where Up/Down pick a group
 *    (which becomes the shown one) and Right enters it; Space commits, Escape cancels,
 *    Enter/Tab are inert);
 *  - the PREVIEW, rendered by the same code as a pointer drag: the source (and the other
 *    selected) rows collapse via `collapseRows`, and the current target's insertion gap goes
 *    through `applyGap` (the state `onSourceCollapse` / `onDragMove` drive); the new-window
 *    / new-group zones highlight from the store marker; the ghost copy is docked in the gap;
 *  - announcements to the app-owned live region, scrolling the target into view, and focus
 *    (the host holds it during the move so it is never on a collapsed row; drop: the commit
 *    focuses the landed row; cancel: back where it started).
 *
 * The picked-up item stays the SAME item when the groups change underneath (a sync pull, a
 * Now Open update, any cache update). Model ids are positional, so on every cache update the
 * source is re-anchored BY IDENTITY with `rebaseMove` (the rebase a pointer drop runs) and
 * the targets are rebuilt around where it now is. If an item can no longer be identified
 * (it is gone, identical duplicates were permuted, or a missing selection member may have
 * been edited) the move is cancelled and says so. A drop therefore never moves an item
 * other than the one picked up.
 *
 * The pure state machine is `@/lib/keyboardMove`; the commit is `commitKeyboardMove`, the
 * exact tail pointer drops use.
 */
export function useKeyboardMove(hostRef?: RefObject<HTMLElement | null>): void {
  const qc = useQueryClient();
  const { commitKeyboardMove, applyGap } = useDndContext();
  const request = useKeyboardMoveStore((s) => s.request);
  const live = useRef<Live | null>(null);
  const commitRef = useRef(commitKeyboardMove);
  commitRef.current = commitKeyboardMove;
  const gapRef = useRef(applyGap);
  gapRef.current = applyGap;

  useEffect(() => {
    if (!request) return;
    useKeyboardMoveStore.getState().clearRequest();
    if (live.current) return;
    // Deferred out of the effect: pick-up uses `flushSync`, which React refuses to run
    // while it is still flushing passive effects.
    queueMicrotask(() => {
      if (!live.current) begin(request.kind, request.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // The popup closing / this provider unmounting mid-move must not leave the flag set.
  useEffect(() => () => live.current?.dispose(), []);

  function options(): MoveOptions {
    return {
      activeGroupIndex: useUIStore.getState().activeGroupIndex ?? 0,
      newGroupAllowed: !getNewGroupZoneGate().atLimit,
      isVisible: isRendered
    };
  }

  function markSources(ids: string[], on: boolean): void {
    for (const id of ids) {
      const el = rowFor(id);
      if (!el) continue;
      if (on) el.setAttribute('data-tm-move-source', '');
      else el.removeAttribute('data-tm-move-source');
    }
  }

  function begin(kind: MoveKind, picked: string): void {
    const found = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
    if (!found) return;
    const base: GroupsState = found;
    const model = buildDndModel(base);
    if (!(model.tabs[picked] || model.windows[picked] || model.groups[picked])) return;
    /** The picked-up row's model id. Positional: it follows the item when the groups change (see `retarget`). */
    let id = picked;
    const ui = useUIStore.getState();
    const shownAtStart = ui.activeGroupIndex ?? 0;
    // Same rule as a pointer drag: a selected row carries the whole (same-type) selection;
    // an unselected one moves alone and clears the selection.
    let ids = promoteStoreSelection(model, id, kind, ui.selectedItems ?? []) ?? [id];
    if (kind === 'group') ids = ids.filter((g) => g !== model.permanentGroupId);
    if (!ids.includes(id)) ids = [id, ...ids];
    if (ids.length === 1 && (ui.selectedItems?.length ?? 0) > 0) ui.clearSelection?.();
    if (kind === 'group') {
      // A picked-up group becomes the shown one (like the pointer path).
      const gi = model.groups[id]?.index ?? 0;
      if (gi > 0 && gi !== ui.activeGroupIndex) ui.setActiveGroupIndex(gi);
    }
    let source: MoveSource = { kind, anchorId: id, ids };
    let ms = startMove(base, source, options());
    let origin = document.activeElement as HTMLElement | null;
    /** The groups state (and its model) the moving ids and the targets were last resolved against. */
    let anchored = base;
    let anchoredModel = model;
    /** A cache update is waiting for its render (see `catchUp`); `held` is the target the cursor was on before it. */
    let rerendering = false;
    let held: MoveTarget | null = null;
    let done = false;
    let collapsed: CollapseHandle | null = null;
    let ghost: MoveGhost | null = null;
    /** outer height of the anchor row: the size of the gap, exactly as the pointer's `onSourceCollapse` measures it */
    let height = 0;
    let followFrame: number | null = null;
    /** the sidebar row carrying the list-cursor ring */
    let cursorEl: HTMLElement | null = null;
    let scrollBehavior: ScrollBehavior = 'auto';
    let publishedScope: MoveScope | undefined;

    /** Collapse the moving rows that are currently rendered (the pointer's `collapseSource`, minus the dnd-kit bits). */
    const collapseRendered = () => {
      collapsed?.restore();
      collapsed = null;
      const rows = ids.map(rowFor).filter((r): r is HTMLElement => r !== null);
      const measured = measureRows(rows);
      if (measured.length === 0) return;
      const anchor = measured.find((m) => m.id === id);
      if (anchor && height === 0) height = anchor.height;
      collapsed = collapseRows(measured);
    };

    const gapFor = (t: ReturnType<typeof currentTarget>) =>
      t && height > 0 ? makeGap(height, t.gap.containerKey, t.gap.shiftIds) : null;

    /** Dock the copy at the current target, kept inside the visible area of its scroll containers. */
    const placeGhost = () => {
      const t = currentTarget(ms);
      const h = ghost?.height() ?? 0;
      const rect = dockRectFor(t, height);
      const anchor = anchorFor(t);
      ghost?.place(rect && anchor ? clampToVisible(anchor, rect, h) : rect);
    };

    /** Scroll the copy (and the list cursor row) into view, nearest edge, then dock it. */
    const settle = () => {
      const t = currentTarget(ms);
      const h = ghost?.height() ?? 0;
      const rect = dockRectFor(t, height);
      const anchor = anchorFor(t);
      if (rect && anchor) revealSpan(anchor, { top: rect.top, bottom: rect.top + (rect.reveal ?? h) }, scrollBehavior);
      if (cursorEl) {
        const c = cursorEl.getBoundingClientRect();
        revealSpan(cursorEl, { top: c.top, bottom: c.bottom }, scrollBehavior);
      }
      placeGhost();
    };

    const followGhost = () => {
      if (followFrame != null) cancelAnimationFrame(followFrame);
      let n = 0;
      const tick = () => {
        followFrame = null;
        if (done) return;
        // When the render changed the preview, `catchUp` has republished it (a fresh run).
        if (rerendering && catchUp()) return;
        settle();
        if (++n < GHOST_FOLLOW_FRAMES) followFrame = requestAnimationFrame(tick);
        else {
          rerendering = false;
          held = null;
        }
      };
      followFrame = requestAnimationFrame(tick);
    };

    /** Render the current target: zone highlight, insertion gap, docked ghost, scroll. */
    const publish = (sync = false) => {
      const t = currentTarget(ms);
      useKeyboardMoveStore.getState().setLive(source.kind, t?.marker ?? null);
      markCursor();
      const gap = gapFor(t);
      if (sync) flushSync(() => gapRef.current(gap));
      else gapRef.current(gap);
      // A different group is now shown (its rows just remounted, scrolled to the top): jump
      // straight to the copy instead of animating from the top.
      scrollBehavior = ms.scope !== publishedScope || publishedScope === undefined ? 'auto' : motionScrollBehavior();
      publishedScope = ms.scope;
      settle();
      followGhost();
    };

    /** Make `scope` the shown group (the pointer's spring-open), re-collapsing the moving rows that remount. */
    const showScope = (scope: MoveScope) => {
      if (typeof scope !== 'number' || (useUIStore.getState().activeGroupIndex ?? 0) === scope) return;
      holdInstantFrames();
      flushSync(() => useUIStore.getState().setActiveGroupIndex(scope));
      collapseRendered();
    };

    /** Ring the group row the list cursor is on (the shown group follows it; the ring says "you are in the list"). */
    const markCursor = () => {
      const latest = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY) ?? base;
      const group = ms.mode === 'list' && typeof ms.scope === 'number' ? latest.available[ms.scope] : undefined;
      const want = group ? rowFor(group.id) : null;
      if (cursorEl === want) return;
      cursorEl?.removeAttribute('data-tm-move-cursor');
      want?.setAttribute('data-tm-move-cursor', '');
      cursorEl = want;
    };

    /** Up / Down in the group list: the previous / next group that can take the item, wrapping. */
    const stepList = (dir: MoveDirection): { next: MoveState; wrapped: boolean } | null => {
      const latest = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY) ?? base;
      const stops = listStops(latest, source, options());
      let from: MoveScope = ms.scope;
      for (let guard = 0; guard < 64; guard++) {
        const hop = listNeighbor(from, dir, stops);
        if (!hop) break;
        showScope(hop.scope);
        const entered = enterListScope(ms, hop.scope, latest, options());
        if (entered) return { next: entered, wrapped: hop.wrapped };
        from = hop.scope;
      }
      // Nowhere to go: stay where we were (undo any group we peeked at).
      showScope(ms.scope);
      return null;
    };

    const cancel = (text?: string, sync = true) => {
      if (done) return;
      const latest = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY) ?? base;
      if (sync) flushSync(() => dispose(true));
      else dispose(true);
      announceDnd(text ?? describeDropBail(latest, id, 'cancelled', ids.length));
      if (origin && origin.isConnected) origin.focus();
      else focusFirst(ownFocusSelectors(latest, id));
    };

    const onKey = (e: KeyboardEvent) => {
      if (done) return;
      const consume = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      const space = e.key === ' ' || e.code === 'Space';
      const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
      // A held Space (the pick-up keypress auto-repeating) must not commit.
      if (e.repeat) {
        consume();
        return;
      }
      if (e.code === 'Escape' || e.key === 'Escape') {
        consume();
        cancel();
        return;
      }
      if (space && plain) {
        consume();
        void commit();
        return;
      }
      // Inert while moving: Enter must never drop or open, Tab must not walk focus away.
      if (e.code === 'Enter' || e.key === 'Enter' || e.code === 'Tab' || e.key === 'Tab' || space) {
        consume();
        return;
      }
      const latest = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY) ?? base;
      let next: MoveState | null = ms;
      let text: string | null = null;
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        const dir: MoveDirection = e.code === 'ArrowDown' ? 'down' : 'up';
        if (ms.mode === 'list') {
          const hop = stepList(dir);
          next = hop?.next ?? null;
          if (hop) text = `${hop.wrapped ? `${describeWrap(dir)} ` : ''}${describeListStop(latest, hop.next.scope)}`;
        } else {
          next = stepMove(ms, dir);
          text = `${wouldWrap(ms, dir) ? `${describeWrap(dir)} ` : ''}${currentTarget(next)?.text ?? ''}`;
        }
      } else if (e.code === 'ArrowLeft') {
        // Main panel -> group list. Nothing for groups (they reorder in the sidebar) or inside the list.
        next = enterList(ms);
        if (next) text = describeListStop(latest, next.scope);
      } else if (e.code === 'ArrowRight') {
        // Group list -> into the highlighted group. Nothing in the main panel or on "new group".
        next = enterGroup(ms);
        if (next) text = describeGroupEntry(latest, next);
      } else return;
      consume();
      if (!next || next === ms) return;
      ms = next;
      held = null;
      if (live.current) live.current.ms = ms;
      if (text) announceDnd(text);
      publish();
    };

    const onPointerDown = () => cancel('Movement cancelled.');
    const onBlur = () => cancel('Movement cancelled.');
    const onLayout = () => placeGhost();

    /** The picked-up item(s) can no longer be identified in the groups: end the move and say why. */
    const cancelStale = () => {
      dndDebugLog('keyboard:cancelled-stale', { from: id });
      cancel(GROUPS_CHANGED_TEXT, false);
    };

    /** The moving items now sit at `next`'s ids: the collapsed / marked rows of the preview follow them. */
    const retarget = (next: MoveSource) => {
      dndDebugLog('keyboard:reanchored', { from: id, to: next.anchorId, count: next.ids.length });
      markSources(ids, false);
      // A cancel returns focus to the item's own row, wherever it is now.
      if (next.anchorId !== id) origin = null;
      id = next.anchorId;
      ids = next.ids;
      source = next;
      ghost?.setCount(ids.length);
      collapseRendered();
      markSources(ids, true);
    };

    /** Take rebuilt targets: speak the cursor's target when it reads differently from `before`, then render it. */
    const adopt = (next: MoveState, before: MoveTarget | null) => {
      ms = next;
      if (live.current) live.current.ms = ms;
      const t = currentTarget(ms);
      if (t && t.text !== before?.text) announceDnd(t.text);
      publish();
    };

    /**
     * The rows re-render a moment after a cache update. Once they are in the DOM: collapse
     * the moving rows that have just mounted, and rebuild the targets from the rows that
     * are really there (the cursor keeps the target it had before the update). True when
     * that changed the preview, which was then republished.
     */
    function catchUp(): boolean {
      const holding = new Set((collapsed?.rows ?? []).map((m) => m.row));
      const arrived = ids.some((x) => {
        const row = rowFor(x);
        return row !== null && !holding.has(row);
      });
      if (arrived) {
        collapseRendered();
        markSources(ids, true);
      }
      const rebuilt = rebuildMove(held ? { ...ms, targets: [held], index: 0 } : ms, anchored, options());
      if (!rebuilt || JSON.stringify([rebuilt.index, rebuilt.targets]) === JSON.stringify([ms.index, ms.targets])) return false;
      adopt(rebuilt, currentTarget(ms));
      return true;
    }

    const unsubscribe = qc.getQueryCache().subscribe((event) => {
      if (done || event.type !== 'updated' || event.query.queryKey[0] !== GROUPS_QUERY_KEY[0]) return;
      const state = event.query.state.data as GroupsState | undefined;
      if (!state) return;
      // The picked-up item(s) stay the SAME item(s): find them again by identity, exactly as a
      // pointer drop re-resolves its dragged items, before anything is rebuilt around them.
      let next = source;
      if (state !== anchored) {
        const nextModel = buildDndModel(state);
        const rebased = rebaseMove(anchored, anchoredModel, state, nextModel, activeRefFor(source), ANY_STATE_TARGET);
        if (!rebased) {
          cancelStale();
          return;
        }
        const nextIds = rebased.active.selectionIds ?? [rebased.active.id];
        if (nextIds.length !== ids.length || nextIds.some((x, i) => x !== ids[i])) {
          next = { kind, anchorId: rebased.active.id, ids: nextIds };
        }
        anchored = state;
        anchoredModel = nextModel;
      }
      const rebuilt = rebuildMove({ ...ms, source: next }, state, options());
      if (!rebuilt) {
        cancelStale();
        return;
      }
      const before = currentTarget(ms);
      if (next !== source) retarget(next);
      held ??= before;
      rerendering = true;
      adopt(rebuilt, before);
    });

    /** End the move's preview + listeners. `restoreShown`: cancel puts the originally shown group back. */
    function dispose(restoreShown = false) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('scroll', onLayout, true);
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('blur', onBlur);
      unsubscribe();
      if (followFrame != null) cancelAnimationFrame(followFrame);
      markSources(ids, false);
      cursorEl?.removeAttribute('data-tm-move-cursor');
      cursorEl = null;
      collapsed?.restore();
      collapsed = null;
      ghost?.remove();
      ghost = null;
      gapRef.current(null);
      clearDndDragLive();
      useKeyboardMoveStore.getState().setLive(null, null);
      if (restoreShown) {
        const store = useUIStore.getState();
        if ((store.activeGroupIndex ?? 0) !== shownAtStart) store.setActiveGroupIndex(shownAtStart);
      }
      live.current = null;
    }

    async function commit() {
      const t = currentTarget(ms);
      const latest = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY) ?? base;
      if (!t || !t.over) {
        flushSync(() => dispose(true));
        announceDnd(describeDropBail(latest, id, 'noop', ids.length));
        if (origin && origin.isConnected) origin.focus();
        else focusFirst(ownFocusSelectors(latest, id));
        return;
      }
      // Preview teardown and the commit land in ONE React commit, like a pointer drop.
      let tail: Promise<void> | undefined;
      flushSync(() => {
        dispose();
        tail = commitRef.current(activeRefFor(source), t.over as NonNullable<typeof t.over>);
      });
      await tail;
    }

    live.current = { ms, origin, dispose };
    setDndDragLive('keyboard');
    markSources(ids, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('scroll', onLayout, true);
    window.addEventListener('resize', onLayout);
    window.addEventListener('blur', onBlur);
    announceDnd(describePickup(base, source));

    // Pick-up preview, in the pointer's order: focus leaves the row that is about to
    // collapse, the ghost is cloned while the row still has its content, then the gap opens
    // at the source's own slot in the same task the rows collapse (no jump).
    hostRef?.current?.focus({ preventScroll: true });
    const anchorRow = rowFor(id);
    if (anchorRow) ghost = createMoveGhost(anchorRow, ids.length);
    const measured = measureRows(ids.map(rowFor).filter((r): r is HTMLElement => r !== null));
    height = measured.find((m) => m.id === id)?.height ?? 0;
    holdInstantFrames();
    publish(true);
    collapsed = collapseRows(measured);
  }
}
