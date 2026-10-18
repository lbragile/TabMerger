import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/stores/uiStore';
import { useGroups, useDeleteGroup, GROUPS_QUERY_KEY } from '@/hooks/useGroups';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useTourAutoStart } from '@/hooks/useTourAutoStart';
import { useTourFrame, useTourHighlight } from '@/hooks/useTourAnchorRect';
import { useTourKeys } from '@/hooks/useTourKeys';
import { useTourPracticeTab } from '@/hooks/useTourPracticeTab';
import {
  availableTourSteps,
  backdropPanels,
  cardPositionAvoidingByPriority,
  computeCardPosition,
  markTourDone,
  nextChapterIndex,
  pulseScale,
  readTourRecord,
  rectsCoincide,
  resolveTourStartIndex,
  saveTourProgress,
  shouldAutoStartTour,
  spotlightRect,
  tourProgress,
  usesTourDemoData,
  type TourRect,
  type TourStep
} from '@/lib/tour';
import { closeTourPracticeTab, tourPracticeTabUrl } from '@/lib/tourPracticeTab';
import { setTourOpenBlocked, setTourSearchShowsDemo, setTourSpringOpenBlocked } from '@/lib/tourSandbox';
import {
  TOUR_DEMO_GROUP_IDS,
  TOUR_DEMO_MAIN_ID,
  ensureTourDemoGroups,
  isTourDemoEntry,
  removeTourDemoGroups,
  resetTourDemoGroups
} from '@/lib/tourDemo';
import { isDndDragLive } from '@/lib/dndMultiDrag';
import {
  TOUR_TOAST_SELECTOR,
  allowedFocusables,
  findTourElements,
  isForeignLayerOpen,
  isFullyVisible,
  isInAllowed,
  isInForeignLayer,
  isTextEntry,
  lockTourApp,
  revealTourTarget,
  tourFocusReturnTarget,
  tourFrame,
  tourRemToPx
} from '@/lib/tourDom';
import { TOUR_ANCHORS, TOUR_CHAPTERS, TOUR_STEPS } from '@/lib/tourSteps';
import { activeTourTask, findNewGroup, findPracticeGroup, readOnlyTargets, tourTask, type TourTaskContext } from '@/lib/tourTasks';
import { AI_ENABLED } from '@/lib/aiFlag';
import { getGroupTabCount } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { trackEvent } from '@/lib/analytics';
import type { Group, GroupsState } from '@/lib/types';
import { TourCard, type TourTaskStatus } from './TourCard';
import { t } from '@/lib/i18n';

// Sizes in rem, converted to pixels where the positioning maths needs them
const SPOTLIGHT_PADDING_REM = 0.25;
const CARD_GAP_REM = 1;
const FRAME_MARGIN_REM = 0.5;
/** How far the ring's lines are drawn outside the cut-out (see globals.css; the glow beyond them may be cut off). */
const RING_EXTENT_REM = 0.1875;
/** How far the pulse travels beyond the ring. */
const PULSE_TRAVEL_REM = 0.25;
/** The cut-out keeps this far from the popup frame, so the ring and its pulse are never clipped. */
const FRAME_EDGE_REM = RING_EXTENT_REM + PULSE_TRAVEL_REM;
/** Smallest corner radius of the ring: the popup's controls are square, this only softens the corners. */
const MIN_RADIUS_REM = 0.125;
// The action ring: the tight ring on the ONE control to act on next (see globals.css,
// `[data-tour-action]`). Closer to its control and thinner than the region ring.
const ACTION_PADDING_REM = 0.1875;
/** Text-color hairline + the thin secondary-color line. */
const ACTION_RING_EXTENT_REM = 0.1875;
/** How long a ring glides for after it is given a different target (the CSS transition, plus a little). */
const GLIDE_MS = 240;
/** The action ring's cut-out keeps this far from the popup frame: ring + pulse, never clipped. */
const ACTION_FRAME_EDGE_REM = ACTION_RING_EXTENT_REM + PULSE_TRAVEL_REM;

/** How long after a task completes focus is still handed back to the card (a closing popover refocuses its trigger late). */
const HAND_BACK_MS = 500;

/** Id of the toast that offers to remove the practice group after a skipped tour. */
const PRACTICE_TOAST_ID = 'tour-practice-group';

/** The drop marker sits this far outside its destination, and keeps this far from the popup frame. */
const DROP_PADDING_REM = 0.125;
const DROP_FRAME_EDGE_REM = 0.375;
/** Thickness of the drop marker when it is a line under a row (`dropKind: 'below'`). */
const DROP_LINE_REM = 0.25;
/** Room the marker's label takes above (or under) it: the card keeps clear of that too. */
const DROP_LABEL_REM = 1.5;
/** The gap a "below" marker points into, for the card to keep clear of: about one row. */
const DROP_SLOT_REM = 2;
/** Above the copy of the item that follows the pointer (`lib/dndDragVisuals.ts` draws it one below the maximum). */
const DROP_MARKER_Z = 2147483647;
/** How often a source or destination that is scrolled out of view is brought back, at most. */
const REVEAL_EVERY_MS = 250;
/** Id of the step that opens the tour's spare browser tab. */
const SAVE_TABS_STEP = 'save-tabs';
/** How far around the destination a dragged item counts as "over it" (the third sub-step of a drag). */
const DROP_NEAR_REM = 0.5;
/** The copy of the item that follows the pointer, or sits in the gap during a keyboard move. */
const DRAG_GHOST = '[data-testid="drag-ghost"]';
/** The row the keyboard move's group-list cursor is on (`useKeyboardMove`). */
const MOVE_CURSOR_ATTR = 'data-tm-move-cursor';

const chapterOfStep = (stepId: string | null | undefined) => TOUR_STEPS.find((s) => s.id === stepId)?.chapter;

/**
 * Takes the practice ("Tour demo") groups off the list: no dialog, no undo entry, no remote
 * delete. The main panel goes back to "Now Open" first when it was showing one of them.
 */
function useRemoveTourDemo() {
  const qc = useQueryClient();
  return useCallback(() => {
    const ui = useUIStore.getState();
    const shown = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)?.available[ui.activeGroupIndex];
    if (shown && isTourDemoEntry(shown)) ui.setActiveGroupIndex(0);
    void removeTourDemoGroups().then(({ state, changed }) => {
      if (changed) qc.setQueryData(GROUPS_QUERY_KEY, state);
    });
  }, [qc]);
}

/** Stable "no action ring" value, so the measuring hook is not handed a new array every render. */
const NO_ACTION: string[][] = [];

const sameElements = (a: readonly Element[], b: readonly Element[]) => a.length === b.length && a.every((el, i) => el === b[i]);

/**
 * Guided tour of the popup. Mount once, inside the loaded app (the anchors must exist).
 *
 * Starts by itself after a first install (`useTourAutoStart`), or from the header's "?"
 * button and Settings. It steps aside while a modal is open (sign-in, encryption setup, the
 * shortcut save picker and upgrade prompts all go through `uiStore.modal`), except for the one
 * modal an interactive step asks the user to open (Settings, for the theme step).
 */
export function Tour() {
  const active = useUIStore((s) => s.tourActive);
  const setTourPracticeGroupId = useUIStore((s) => s.setTourPracticeGroupId);
  const { data: groupsState } = useGroups();
  const { mutate: deleteGroup } = useDeleteGroup();
  useTourAutoStart();

  // A popup that was closed in the middle of a chapter that uses the practice groups could not
  // remove them. Once per popup open: unless the tour is about to resume in such a chapter (or
  // is already showing one), they go, so nobody is left with a stray "Tour demo" group. The
  // same for the spare browser tab of the "save a tab" step (closed only while it still shows
  // the tour's own practice page).
  const removeTourDemo = useRemoveTourDemo();
  useEffect(() => {
    void readTourRecord().then((record) => {
      const resumes = shouldAutoStartTour(record);
      const ui = useUIStore.getState();
      const resumesThere = resumes && usesTourDemoData(chapterOfStep(record?.stepId));
      const showingIt = ui.tourActive && usesTourDemoData(chapterOfStep(ui.tourStepId));
      if (!resumesThere && !showingIt) removeTourDemo();
      const tabStillWanted = (resumes && record?.stepId === SAVE_TABS_STEP) || (ui.tourActive && ui.tourStepId === SAVE_TABS_STEP);
      if (record?.practiceTabId && !tabStillWanted) void closeTourPracticeTab(record.practiceTabId);
    });
    // Once per popup open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lives here, not in the overlay: the "remove it" offer made when the tour is skipped is a
  // toast, which outlives the overlay
  const groupsRef = useRef<readonly Group[]>([]);
  useEffect(() => {
    groupsRef.current = groupsState?.available ?? [];
  });
  const removePracticeGroup = useCallback(
    (groupId: string) => {
      // By id, and never the permanent group: only the group the tour itself asked for
      const index = groupsRef.current.findIndex((g) => g.id === groupId && !g.permanent);
      if (index > 0) deleteGroup(index);
      setTourPracticeGroupId(null);
      void readTourRecord().then((record) => {
        if (record?.status === 'done') void markTourDone(null);
      });
    },
    [deleteGroup, setTourPracticeGroupId]
  );

  if (!active || !groupsState) return null;
  return <TourOverlay groups={groupsState.available} removePracticeGroup={removePracticeGroup} />;
}

interface TourOverlayProps {
  groups: readonly Group[];
  removePracticeGroup: (groupId: string) => void;
}

function TourOverlay({ groups, removePracticeGroup }: TourOverlayProps) {
  const stepId = useUIStore((s) => s.tourStepId);
  const setTourStepId = useUIStore((s) => s.setTourStepId);
  const endTour = useUIStore((s) => s.endTour);
  const practiceGroupId = useUIStore((s) => s.tourPracticeGroupId);
  const setTourPracticeGroupId = useUIStore((s) => s.setTourPracticeGroupId);
  const modalType = useUIStore((s) => s.modal.type);
  const searchFilter = useUIStore((s) => s.searchFilter);
  const renameTarget = useUIStore((s) => s.renameTarget);
  const previewGroupColor = useUIStore((s) => s.previewGroupColor);
  const signals = useUIStore((s) => s.tourSignals);
  const selectionMode = useUIStore((s) => s.selectionMode);
  const selectedItems = useUIStore((s) => s.selectedItems);
  const { data: settings } = useAppSettings();
  const { maxGroups } = useEntitlements();
  const cardRef = useRef<HTMLDivElement>(null);
  // What had focus when the tour appeared: focus goes back there when it ends
  const [launcher] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));

  // Steps this user can be shown. Read after the commit, when the anchors exist.
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  useLayoutEffect(() => {
    setSteps(availableTourSteps(TOUR_STEPS, document, { aiEnabled: AI_ENABLED }));
  }, []);

  const index = steps ? resolveTourStartIndex(steps, stepId) : 0;
  const step = steps?.[index] ?? null;
  const total = steps?.length ?? 0;
  const currentId = step?.id;
  const isLast = index === total - 1;

  // ── Interactive steps: real state in, "done" out ────────────────────────────────────────
  // Done stays done for this run, so Back onto a finished step does not ask for it again
  const [completed, setCompleted] = useState<ReadonlySet<string>>(() => new Set());
  // The "save a tab" step works on a spare browser tab of the tour's own: open while that step
  // is waiting to be tried, closed again as soon as it is not (see the hook)
  const practiceTab = useTourPracticeTab(currentId === SAVE_TABS_STEP && !completed.has(SAVE_TABS_STEP));
  const practiceTabUrl = useMemo(() => tourPracticeTabUrl(), []);
  const ctx: TourTaskContext = useMemo(
    () => ({
      groups,
      practiceGroupId,
      maxGroups,
      renamingGroupIndex: renameTarget?.kind === 'group' ? renameTarget.groupIndex : null,
      searchFilter,
      theme: settings?.theme ?? null,
      modalType,
      previewColor: previewGroupColor && previewGroupColor.groupId === practiceGroupId ? previewGroupColor.color : null,
      practiceTab: { ...practiceTab, url: practiceTabUrl },
      signals,
      selectionMode,
      selectedIds: selectedItems.map((item) => item.id)
    }),
    [groups, practiceGroupId, maxGroups, renameTarget, searchFilter, settings?.theme, modalType, previewGroupColor, practiceTab, practiceTabUrl, signals, selectionMode, selectedItems]
  );
  const task = activeTourTask(step, ctx);
  const practice = findPracticeGroup(ctx);

  // The state the step started from, taken once per visit (and again once it can be taken:
  // settings may still be loading on the first render)
  const [entry, setEntry] = useState<{ id: string; baseline: unknown } | null>(null);
  if (step && task && entry?.id !== step.id) {
    const baseline = task.baseline(ctx);
    if (baseline !== null) setEntry({ id: step.id, baseline });
  }
  const liveDone = !!step && !!task && entry?.id === step.id && task.isDone(ctx, entry.baseline);
  useEffect(() => {
    if (!liveDone || !currentId || completed.has(currentId)) return;
    // (also the guard that sends the event once per step, whether or not the result is remembered)
    setCompleted((prev) => new Set(prev).add(currentId));
    trackEvent('tour_task_done', { step_id: currentId });
  }, [liveDone, currentId, completed]);
  // A task with a halfway point (see `TourTask.milestone`): counted each time it is reached
  const milestone = (step && task && entry?.id === step.id ? task.milestone?.(ctx) : null) ?? null;
  useEffect(() => {
    if (milestone) useUIStore.getState().signalTour(milestone);
  }, [milestone, currentId]);
  const done = !!currentId && (liveDone || (task?.remember !== false && completed.has(currentId)));
  const taskStatus: TourTaskStatus = !task ? 'none' : done ? 'done' : 'todo';

  // The chapter's description is announced once per chapter and run: on the first step of that
  // chapter the user is shown, however they got there (Next, "Skip chapter", a resumed tour).
  // Decided when the step is entered and then fixed for the visit, so the announcement's text
  // never changes under a screen reader while the step is up.
  const [visit, setVisit] = useState<{ id: string; introduces: boolean; seen: ReadonlySet<string> }>({
    id: '',
    introduces: false,
    seen: new Set()
  });
  if (step && visit.id !== step.id) {
    const introduces = !visit.seen.has(step.chapter);
    setVisit({ id: step.id, introduces, seen: introduces ? new Set(visit.seen).add(step.chapter) : visit.seen });
  }
  const introducesChapter = !!step && visit.id === step.id && visit.introduces;

  // A replay started from the header knows nothing of the practice group yet: ask the record.
  // Declared before the effect that writes progress, so this read is issued first.
  useEffect(() => {
    if (useUIStore.getState().tourPracticeGroupId) return;
    let canceled = false;
    void readTourRecord().then((record) => {
      if (!canceled && record?.practiceGroupId && !useUIStore.getState().tourPracticeGroupId) {
        setTourPracticeGroupId(record.practiceGroupId);
      }
    });
    return () => {
      canceled = true;
    };
  }, [setTourPracticeGroupId]);

  // "Make a group": the group that was not there when the step was entered is the practice group
  const makeGroupBaseline = step?.task === 'make-group' && task && entry?.id === step.id ? (entry.baseline as string[]) : null;
  useEffect(() => {
    if (!makeGroupBaseline || practice) return;
    const fresh = findNewGroup(groups, makeGroupBaseline);
    if (fresh) setTourPracticeGroupId(fresh.id);
  }, [makeGroupBaseline, practice, groups, setTourPracticeGroupId]);

  // ── The practice ("Tour demo") groups ───────────────────────────────────────────────────
  // They exist exactly while a step of a chapter that uses them is up (`TOUR_DEMO_CHAPTERS`:
  // the drag chapter and the two after it, so going from one to the next keeps the same
  // set). Every such step makes sure both are there when it opens, and puts a fresh set in
  // place when what is left of them cannot serve the step (the user moved every sample tab
  // away, say): the user is never asked to make anything first. Leaving those chapters, in any
  // direction and by any button, or ending the tour (this component unmounts) removes them.
  const qc = useQueryClient();
  const removeTourDemo = useRemoveTourDemo();
  const inDragChapter = usesTourDemoData(step?.chapter);
  const stepTaskId = step?.task;
  useEffect(() => {
    if (!inDragChapter || !currentId) return;
    void ensureTourDemoGroups().then(async (made) => {
      let result = made;
      const wanted = stepTaskId ? tourTask(stepTaskId) : null;
      const fresh = { ...ctx, groups: made.state.available };
      if (wanted && (!wanted.available(fresh) || wanted.needsFresh?.(fresh))) result = await resetTourDemoGroups();
      if (result.changed) qc.setQueryData(GROUPS_QUERY_KEY, result.state);
    });
    // On entering each step of the chapter (`ctx` is only read for the plan and practice ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, inDragChapter]);
  useEffect(() => {
    if (!inDragChapter) return;
    return removeTourDemo;
  }, [inDragChapter, removeTourDemo]);
  // While those chapters are up, two things keep the user's own data out of it. "Open in
  // browser" opens nothing (the sample tabs are not real pages; the request is only counted for
  // the step that asks for it). And "Undo" / "Redo" run on a history of the practice data alone:
  // the user's own history is put aside on the way in and put back, untouched, on the way out.
  useEffect(() => {
    if (!inDragChapter) return;
    setTourOpenBlocked(true);
    useUIStore.getState().beginTourHistory();
    return () => {
      setTourOpenBlocked(false);
      useUIStore.getState().endTourHistory();
    };
  }, [inDragChapter]);
  // The practice groups can be found by search only while a search step is up
  const searchesDemo = (stepTaskId === 'search' || stepTaskId === 'search-filters') && !!task;
  useEffect(() => {
    if (!searchesDemo) return;
    setTourSearchShowsDemo(true);
    return () => setTourSearchShowsDemo(false);
  }, [searchesDemo]);

  // Remember the step (and the practice groups) so the tour resumes here after the popup closes
  const practiceId = practice?.id ?? null;
  const practiceTabId = practiceTab.id;
  useEffect(() => {
    if (currentId) void saveTourProgress(currentId, practiceId, inDragChapter ? TOUR_DEMO_GROUP_IDS : [], practiceTabId);
  }, [currentId, practiceId, inDragChapter, practiceTabId]);

  // Entering a step may pick the group shown; leaving one closes whatever it opened
  const leaveModal = task?.modal ?? null;
  const activate = step?.activate ?? null;
  const isSearchStep = step?.task === 'search' || step?.task === 'search-filters';
  const isSelectStep = step?.task === 'select-items';
  const isUndoStep = step?.task === 'undo';
  useEffect(() => {
    if (!currentId) return;
    if (activate === 'now-open') useUIStore.getState().setActiveGroupIndex(0);
    // The undo step starts from "nothing to undo", so each button lights up when it is its turn
    if (isUndoStep) useUIStore.getState().clearTourHistory();
    return () => {
      const ui = useUIStore.getState();
      // Menus, popovers, the color picker and the search box (see `useCloseOnOverlayDismiss`)
      ui.dismissOverlays();
      if (leaveModal && ui.modal.type === leaveModal) ui.closeModal();
      // A search stays until it is cleared: what a search step had the user type must not go on
      // filtering the next step, or the user's own groups after the tour
      if (isSearchStep) ui.setSearchFilter('');
      // (only when the step turned it on: a selection of the user's own is never open under the tour)
      if (isSelectStep && ui.selectionMode) ui.exitSelectionMode();
    };
    // Per step, not per render: the values above are fixed for a given step
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  // A search of the user's own is put aside for the whole tour and put back when it ends. A
  // search stays until it is cleared, and in "hide" mode it would hide the very groups the
  // steps point at. (Declared after the effect above on purpose: when the tour ends, that one
  // clears what a search step typed first, and this one then restores the user's own text.)
  useEffect(() => {
    const own = useUIStore.getState().searchFilter;
    if (own) useUIStore.getState().setSearchFilter('');
    return () => {
      if (own) useUIStore.getState().setSearchFilter(own);
    };
  }, []);

  // Another modal (sign-in, encryption setup, an upgrade prompt…) takes over: step aside
  const suspended = modalType !== null && modalType !== (task?.modal ?? null);

  // ── Locking the app, except what the step lets the user operate ─────────────────────────
  const targets = useMemo(() => (!step ? null : task ? task.targets(ctx) : readOnlyTargets(step)), [step, task, ctx]);
  const allowedRef = useRef<Element[]>([]);
  const lockRef = useRef<{ unlock: () => void; allow: Element[]; roots: Element[] } | null>(null);
  const dirtyRef = useRef(true);
  const unlock = useCallback(() => {
    lockRef.current?.unlock();
    lockRef.current = null;
    allowedRef.current = [];
  }, []);
  const relock = useCallback(() => {
    if (!targets) return;
    const allow = findTourElements(targets.allow);
    const roots = findTourElements(targets.lockRoots);
    const current = lockRef.current;
    if (current && !dirtyRef.current && sameElements(current.allow, allow) && sameElements(current.roots, roots)) return;
    dirtyRef.current = false;
    current?.unlock();
    lockRef.current = { unlock: lockTourApp(allow, roots), allow, roots };
    allowedRef.current = allow;
  }, [targets]);

  const drawn = !!step && !suspended;
  useLayoutEffect(() => {
    if (!drawn) return;
    dirtyRef.current = true;
    relock();
    // Elements React adds later are not inert until the next lock: note that something changed
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => (dirtyRef.current = true));
    observer?.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer?.disconnect();
      unlock();
    };
  }, [drawn, relock, unlock]);

  // The "remove the practice group" offer of an earlier, skipped run must not sit on top of this one
  useEffect(() => {
    toast.dismiss(PRACTICE_TOAST_ID);
  }, []);

  // ── Leaving ─────────────────────────────────────────────────────────────────────────────
  const [practiceRemoved, setPracticeRemoved] = useState(false);
  const finish = useCallback(
    (outcome: 'completed' | 'skipped') => {
      if (outcome === 'completed') trackEvent('tour_completed', { steps: total });
      else trackEvent('tour_skipped', { step: index + 1, step_id: currentId ?? '' });
      void markTourDone(practice?.id ?? null);
      if (!practice) setTourPracticeGroupId(null);
      // Unlock before moving focus: an inert element cannot be focused
      unlock();
      tourFocusReturnTarget(launcher, TOUR_ANCHORS.help)?.focus();
      endTour();
      // The last step offers this on the card. A skipped tour never gets there.
      if (outcome === 'skipped' && practice) {
        const { id, name } = practice;
        toast(t('tour.practiceLeft', { name }), {
          id: PRACTICE_TOAST_ID,
          duration: 12_000,
          action: { label: t('tour.removeIt'), onClick: () => removePracticeGroup(id) }
        });
      }
    },
    [total, index, currentId, practice, launcher, endTour, unlock, setTourPracticeGroupId, removePracticeGroup]
  );

  const goTo = useCallback(
    (next: number) => {
      const target = steps?.[next];
      if (target) setTourStepId(target.id);
    },
    [steps, setTourStepId]
  );
  const next = useCallback(() => (isLast ? finish('completed') : goTo(index + 1)), [isLast, finish, goTo, index]);
  const back = useCallback(() => goTo(index - 1), [goTo, index]);
  // Leaving from the last step, by Done, Enter or Escape, is a finished tour: there is nothing left to skip
  const skip = useCallback(() => finish(isLast ? 'completed' : 'skipped'), [finish, isLast]);
  const skipStep = useCallback(() => {
    if (currentId) trackEvent('tour_step_skipped', { step_id: currentId });
    next();
  }, [currentId, next]);
  const chapterTarget = steps ? nextChapterIndex(steps, index) : -1;
  const skipChapter = useCallback(() => {
    if (step) trackEvent('tour_chapter_skipped', { chapter: step.chapter });
    goTo(chapterTarget);
  }, [step, goTo, chapterTarget]);

  useTourKeys(cardRef, {
    onNext: (via) => {
      // An interactive step moves on once it is done, or by "Skip this step": never by a stray key
      if (taskStatus === 'todo') return;
      // The right arrow never ends the tour by accident: only Enter or the Done button do
      if (via === 'arrow' && isLast) return;
      next();
    },
    onBack: back,
    onSkip: skip,
    getAllowed: () => allowedRef.current,
    // A drag step unlocks drag handles only: a press, the drag and Space reach them, nothing else
    dragOnly: () => taskStatus === 'todo' && !!targets?.dragOnly,
    // One Tab from the card reaches the control a waiting task asks for
    allowedFirst: () => taskStatus === 'todo'
  });

  // ── Drawing ─────────────────────────────────────────────────────────────────────────────
  const highlight = useTourHighlight(targets?.highlight ?? [], currentId ?? '', drawn);
  const spotlight = useMemo(
    () =>
      highlight
        ? spotlightRect(highlight.rect, tourRemToPx(SPOTLIGHT_PADDING_REM), tourFrame(), tourRemToPx(FRAME_EDGE_REM))
        : null,
    [highlight]
  );
  // A drag step has three sub-steps, read from the live drag: 1 = nothing picked up yet, 2 = an
  // item is being moved (pointer drag or keyboard move), 3 = it is over the marked destination.
  // A canceled drag is simply "nothing picked up" again.
  const isDragStep = taskStatus === 'todo' && !!targets?.dragOnly;
  const [dragPhaseRaw, setDragPhase] = useState<1 | 2 | 3>(1);
  const dragPhase = isDragStep ? dragPhaseRaw : 1;
  // The action ring: only while the task is still to do, and for a drag only until the item is
  // picked up (the destination's marker takes over from there)
  const actionLists = taskStatus === 'todo' && dragPhase === 1 ? (targets?.action ?? NO_ACTION) : NO_ACTION;
  const dropLists = taskStatus === 'todo' ? (targets?.drop ?? NO_ACTION) : NO_ACTION;
  const dropTarget = useTourHighlight(dropLists, `${currentId ?? ''}:drop`, drawn && dropLists.length > 0);
  // The drop marker: a dashed box around a destination the item goes INTO, or a line along the
  // bottom edge of the row the item goes UNDER (see `TourTargets.dropKind`)
  const dropBelow = targets?.dropKind === 'below';
  const drop = useMemo(() => {
    if (!dropTarget) return null;
    if (!dropBelow) return spotlightRect(dropTarget.rect, tourRemToPx(DROP_PADDING_REM), tourFrame(), tourRemToPx(DROP_FRAME_EDGE_REM));
    const frame = tourFrame();
    const edge = tourRemToPx(DROP_FRAME_EDGE_REM);
    const thickness = tourRemToPx(DROP_LINE_REM);
    const left = Math.max(edge, dropTarget.rect.left);
    const right = Math.min(frame.width - edge, dropTarget.rect.left + dropTarget.rect.width);
    const top = Math.min(Math.max(edge, dropTarget.rect.top + dropTarget.rect.height - thickness / 2), frame.height - edge - thickness);
    return { left, top, width: Math.max(0, right - left), height: thickness };
  }, [dropTarget, dropBelow]);
  // What the card must keep clear of around the marker: its label, and for a line the gap
  // under it, where the item lands
  const dropAvoid = useMemo((): TourRect | null => {
    if (!drop) return null;
    const label = tourRemToPx(DROP_LABEL_REM);
    const slot = dropBelow ? tourRemToPx(DROP_SLOT_REM) : 0;
    // (the label may sit above or under the marker: room for it on both sides)
    return { left: drop.left, top: drop.top - label, width: drop.width, height: drop.height + label * 2 + slot };
  }, [drop, dropBelow]);
  // A destination inside the panel being shown: hovering another group must not switch the panel
  const keepPanel = taskStatus === 'todo' && !!targets?.keepPanel;
  useEffect(() => {
    setTourSpringOpenBlocked(keepPanel);
    return () => setTourSpringOpenBlocked(false);
  }, [keepPanel]);
  const keepClearLists = taskStatus === 'todo' ? (targets?.keepClear ?? NO_ACTION) : NO_ACTION;
  const keepClear = useTourHighlight(keepClearLists, `${currentId ?? ''}:clear`, drawn && keepClearLists.length > 0);
  const actionTarget = useTourHighlight(actionLists, `${currentId ?? ''}:action`, drawn && actionLists.length > 0);
  const action = useMemo(
    () =>
      actionTarget
        ? spotlightRect(actionTarget.rect, tourRemToPx(ACTION_PADDING_REM), tourFrame(), tourRemToPx(ACTION_FRAME_EDGE_REM))
        : null,
    [actionTarget]
  );

  // A ring that is given a DIFFERENT target (the next step, the next control of a task) glides
  // to it. Decided while rendering, so the attribute lands in the same commit as the new
  // position; cleared again shortly after, because a ring that merely follows its target (a
  // menu growing in, a scrolled list) must not ease behind it.
  const regionKey = spotlight && highlight ? `${currentId ?? ''}:${highlight.index}` : null;
  const actionKey = action && actionTarget ? `${currentId ?? ''}:${actionTarget.index}` : null;
  const [glide, setGlide] = useState<{ region: string | null; action: string | null; on: boolean }>({ region: null, action: null, on: false });
  if (glide.region !== regionKey || glide.action !== actionKey) {
    const moved = (glide.region !== null && regionKey !== null && glide.region !== regionKey) || (glide.action !== null && actionKey !== null && glide.action !== actionKey);
    setGlide({ region: regionKey, action: actionKey, on: moved || glide.on });
  }
  useEffect(() => {
    if (!glide.on) return;
    const timer = setTimeout(() => setGlide((prev) => ({ ...prev, on: false })), GLIDE_MS);
    return () => clearTimeout(timer);
  }, [glide]);
  // Which of the task's controls the ring is on, for the card's "2 of 3" marker
  const subSteps = task?.subSteps ?? 0;
  const subStepNow = isDragStep ? dragPhase : actionTarget ? (targets?.actionSteps?.[actionTarget.index] ?? 0) : 0;
  const subStep = taskStatus === 'todo' && subSteps > 1 && subStepNow > 0 ? { current: Math.min(subStepNow, subSteps), total: subSteps } : null;

  const subStepShown = subStep?.current ?? 0;

  // Place the card once it has a size, and again whenever the spotlight or the frame moves
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const taskModalOpen = !!task?.modal && modalType === task.modal;
  // A drag step docks a wide, low card along the bottom of the main panel: the rows being
  // dragged and the drop marker are above it, and the list of groups is left of it
  // (a search step does the same: the search box and its matches fill the middle of the popup)
  const wideCard = !!task && (!!targets?.dragOnly || !!targets?.lowCard);
  const place = useCallback(() => {
    const card = cardRef.current;
    if (!card || !step) return;
    const docked = { left: tourFrame().width - card.offsetWidth - tourRemToPx(FRAME_MARGIN_REM), top: tourFrame().height - card.offsetHeight - tourRemToPx(FRAME_MARGIN_REM) };
    const beside = wideCard ? docked : computeCardPosition({
      anchor: spotlight,
      card: { width: card.offsetWidth, height: card.offsetHeight },
      frame: tourFrame(),
      placement: step.placement,
      gap: tourRemToPx(CARD_GAP_REM),
      margin: tourRemToPx(FRAME_MARGIN_REM),
      // Beside a dialog there is no room: the corner furthest from its buttons
      fallbackCorner: taskModalOpen ? 'bottom-left' : undefined
    });
    // Never on top of the control the action ring is on (a dialog, a menu or a popover may put
    // that control where the card was going to sit)
    const extent = tourRemToPx(ACTION_FRAME_EDGE_REM);
    const size = { width: card.offsetWidth, height: card.offsetHeight };
    const grown = (rect: TourRect): TourRect => ({ left: rect.left - extent, top: rect.top - extent, width: rect.width + extent * 2, height: rect.height + extent * 2 });
    // ...nor on a drag's destination and its label. Those two come first; what the task asks to
    // keep readable besides (a setting's label, the row being picked up) is given up before them
    // when the popup has no room for everything.
    const present = (rects: (TourRect | null)[]) => rects.filter((rect): rect is TourRect => rect !== null).map(grown);
    const avoid = [present([dropAvoid, action]), present([keepClear?.rect ?? null])];
    const { left, top } = cardPositionAvoidingByPriority(beside, size, tourFrame(), tourRemToPx(FRAME_MARGIN_REM), avoid);
    setPosition((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    // `taskStatus`, the chapter header and the practice offer change the card's height
  }, [spotlight, action, dropAvoid, keepClear, step, taskModalOpen, wideCard]);
  useLayoutEffect(() => {
    place();
    window.addEventListener('resize', place);
    // Whatever makes the card taller or shorter (a sub-step's line, the keyboard line, the
    // chapter's description) may put it over the marker: place it again
    const card = cardRef.current;
    const observer = card && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place()) : null;
    if (card) observer?.observe(card);
    return () => {
      window.removeEventListener('resize', place);
      observer?.disconnect();
    };
    // (the sub-step's own line of text changes the card's height too)
  }, [place, taskStatus, practiceRemoved, introducesChapter, drawn, subStepShown]);

  // Focus is kept inside the card. It moves to the card when the tour appears, and again if a
  // step change removed the button that had focus (Back on the first step, Skip on the last).
  // Otherwise it stays where it is, so a step is announced by the card's status line alone,
  // the same way for buttons and for arrow keys (see TourCard). Only once the card is placed:
  // until then it is `invisible`, and a hidden element cannot take focus. Focus that is on a
  // control the step unlocks, or inside a menu or dialog it opened, is left there.
  const placed = position !== null;
  const focusCardIfLost = useCallback(() => {
    const card = cardRef.current;
    if (!card || !placed) return;
    const active = document.activeElement;
    if (active && active !== document.body) {
      if (card.contains(active) || active.closest(TOUR_TOAST_SELECTOR)) return;
      if (isInForeignLayer(active) || isInAllowed(active, allowedRef.current)) return;
    } else if (isForeignLayerOpen()) return;
    card.focus({ preventScroll: true });
  }, [placed]);
  useEffect(() => {
    if (currentId && drawn) focusCardIfLost();
  }, [currentId, drawn, focusCardIfLost]);
  // A finished task hands the keyboard back to the card (Enter = Next), unless the user is
  // still inside the dialog or menu the task opened, or still typing: the search step is done
  // at the first letter, and taking the field away then would swallow the rest of the word.
  // Tab leaves the field for the card's buttons.
  // The window belongs to the step it was opened for: on the NEXT step it must not pull focus
  // back from the control the user has just tabbed to.
  const handBackUntil = useRef({ until: 0, step: '' });
  const handBack = useCallback(() => {
    if (isForeignLayerOpen()) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || cardRef.current?.contains(active)) return;
    if (isTextEntry(active) && isInAllowed(active, allowedRef.current)) return;
    cardRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (taskStatus !== 'done') return;
    // A popover that closes as the task completes (the color picker on "Apply") returns focus
    // to its trigger a moment AFTER this runs: keep handing back for a short while (see the
    // frame loop below). Not for longer, so the user can still Tab back to the control.
    handBackUntil.current = { until: performance.now() + HAND_BACK_MS, step: currentId ?? '' };
    handBack();
  }, [taskStatus, handBack, currentId]);
  // A step that waits for the user starts with focus on the card itself, not on the button
  // that stands where "Next" was a moment ago: that button is now "Skip this step", and a
  // second press of Enter must not skip the task. From the card ONE Tab reaches the control
  // the step asks for (`allowedFirst`), and Enter does nothing until the task is done.
  const waiting = taskStatus === 'todo';
  useEffect(() => {
    const card = cardRef.current;
    if (!waiting || !placed || !card) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== card && card.contains(active)) card.focus({ preventScroll: true });
    // On entering the step only (`currentId`): afterwards the user may Tab to the card's buttons freely
  }, [currentId, waiting, placed]);

  // Once per frame: keep the lock in step with the page, and never leave focus on <body>
  // (a control that became inert, a menu that closed)
  const pinDemoGroup = step?.activate === 'tour-demo';
  const pinNowOpen = step?.activate === 'now-open' && isDragStep;
  const revealAfter = useRef(0);
  const revealClash = useRef('');
  useTourFrame(() => {
    const dragging = isDndDragLive();
    if (isDragStep) {
      let phase: 1 | 2 | 3 = dragging ? 2 : 1;
      if (dragging) {
        const destination = findTourElements(dropLists[0] ?? [])[0];
        const ghost = document.querySelector(DRAG_GHOST)?.getBoundingClientRect();
        const box = destination?.getBoundingClientRect();
        const near = tourRemToPx(DROP_NEAR_REM);
        // The MIDDLE of the carried copy is inside the destination (grown a little): rows next to
        // each other would otherwise count as "over" the moment the item is picked up. For a
        // "below" marker the middle is in the gap under the row instead (or on its lower half,
        // from where the item also lands under it).
        // Across, the copy's LEFT end is what counts: it hangs to the right of the pointer and is
        // as wide as the row it was taken from, so its middle can be far from where the pointer is.
        const x = ghost ? ghost.left + Math.min(ghost.width / 2, tourRemToPx(1)) : 0;
        const y = ghost ? ghost.top + ghost.height / 2 : 0;
        let over = false;
        if (box && ghost && ghost.width > 0) {
          const across = x > box.left - near && x < box.right + near;
          over = dropBelow
            ? across && y > box.bottom - box.height / 2 && y < box.bottom + ghost.height * 3
            : across && y > box.top - near && y < box.bottom + near;
        }
        if (destination && (over || (!dropBelow && destination.hasAttribute(MOVE_CURSOR_ATTR)))) phase = 3;
      }
      setDragPhase((prev) => (prev === phase ? prev : phase));
    }
    // A step on the practice group keeps it in the main panel (a hover may have switched it)
    if (pinDemoGroup && !dragging) {
      const at = groups.findIndex((g) => g.id === TOUR_DEMO_MAIN_ID);
      if (at > 0 && useUIStore.getState().activeGroupIndex !== at) useUIStore.getState().setActiveGroupIndex(at);
    }
    // ...and the step that drags out of Now Open keeps Now Open there until the tab is picked up
    if (pinNowOpen && !dragging && useUIStore.getState().activeGroupIndex !== 0) useUIStore.getState().setActiveGroupIndex(0);
    // The control to use and the destination stay in view: whichever is scrolled out of its list
    // (a long list of groups, a window with many tabs) is brought back. Never while an item is
    // being moved (the lists scroll by themselves then), and the control wins when one list
    // cannot show both.
    if (taskStatus === 'todo' && !dragging && performance.now() >= revealAfter.current) {
      revealAfter.current = performance.now() + REVEAL_EVERY_MS;
      const first = (lists: readonly (readonly string[])[]) => lists.map((list) => findTourElements(list)[0]).find(Boolean);
      const source = first(actionLists);
      const destination = first(dropLists);
      if (source && !isFullyVisible(source)) revealTourTarget(source);
      if (destination && !isFullyVisible(destination) && revealClash.current !== (currentId ?? '')) {
        revealTourTarget(destination, tourRemToPx(DROP_LABEL_REM + DROP_SLOT_REM));
        if (source && !isFullyVisible(source)) {
          revealTourTarget(source);
          revealClash.current = currentId ?? '';
        }
      }
    }
    // While an open dialog of the app hides everything else from assistive technology, the
    // card's own controls stay reachable (they are the way out of the step). Such a dialog hides
    // the card's DIRECT children (the card itself is spared, as the parent of a live region), and
    // none of them is ever hidden on purpose. Not found by the library's marker attribute: when
    // a menu and then a dialog open back to back, the second one hides without marking.
    Array.from(cardRef.current?.children ?? []).forEach((el) => {
      if (el.hasAttribute('aria-hidden')) el.removeAttribute('aria-hidden');
    });
    // An item is being moved: nothing is re-locked and focus is left where the move put it
    if (dragging) return;
    relock();
    if (handBackUntil.current.step === (currentId ?? '') && performance.now() < handBackUntil.current.until) handBack();
    const active = document.activeElement;
    if (active && active !== document.body) return;
    // A dialog the task opened put its focus on a control that is now locked: hand it the
    // first control the step does unlock in there (the Theme list), not the card behind it
    if (isForeignLayerOpen()) allowedFocusables(allowedRef.current).find(isInForeignLayer)?.focus({ preventScroll: true });
    else focusCardIfLost();
  }, drawn);

  if (!step || suspended) return null;

  const frame = tourFrame();
  const ringExtent = tourRemToPx(RING_EXTENT_REM);
  const radius = spotlight && highlight ? Math.max(highlight.radius + tourRemToPx(SPOTLIGHT_PADDING_REM), tourRemToPx(MIN_RADIUS_REM)) : 0;
  const actionExtent = tourRemToPx(ACTION_RING_EXTENT_REM);
  const actionRadius = action && actionTarget ? Math.max(actionTarget.radius + tourRemToPx(ACTION_PADDING_REM), tourRemToPx(MIN_RADIUS_REM)) : 0;
  const actionPulse = action
    ? pulseScale({ width: action.width + actionExtent * 2, height: action.height + actionExtent * 2 }, tourRemToPx(PULSE_TRAVEL_REM))
    : null;
  // With an action ring up, the region stays calm (a thin line, no pulse): the ring is the
  // thing to look at. When both would sit on the same control the region draws no line at all.
  const regionStyle = action
    ? spotlight && rectsCoincide(spotlight, action, tourRemToPx(RING_EXTENT_REM))
      ? 'merged'
      : 'calm'
    : drop
      ? 'calm'
      : '';
  // The drop marker: steady until an item is being dragged, then it is what pulses
  const dropRadius = drop && dropTarget ? Math.max(dropTarget.radius + tourRemToPx(DROP_PADDING_REM), tourRemToPx(MIN_RADIUS_REM)) : 0;
  const dropPulse = drop && dragPhase > 1 ? pulseScale({ width: drop.width + tourRemToPx(0.5), height: drop.height + tourRemToPx(0.5) }, tourRemToPx(PULSE_TRAVEL_REM)) : null;
  // Where the marker's label goes. A line: under it, in the gap the item lands in (above it when
  // the popup ends there). A tall box (a window): above it, or inside its top right corner when
  // the popup starts there. A box one row high (a group in the list): under it, so the label
  // covers neither the group's own name nor the name of the row before it (inside its corner
  // when the popup ends there).
  const labelRoom = tourRemToPx(1.75);
  const roomUnder = !!drop && drop.top + drop.height + labelRoom <= frame.height;
  const dropLabelPlace = !drop
    ? ''
    : dropBelow
      ? roomUnder
        ? 'under'
        : ''
      : drop.height < tourRemToPx(3.5)
        ? roomUnder
          ? 'under'
          : 'inside'
        : drop.top < labelRoom
          ? 'inside'
          : '';
  const pulse = spotlight && !action && !drop
    ? pulseScale({ width: spotlight.width + ringExtent * 2, height: spotlight.height + ringExtent * 2 }, tourRemToPx(PULSE_TRAVEL_REM))
    : null;
  // An interactive step leaves a hole in the click-catcher over what it highlights
  const holed = taskStatus !== 'none' && spotlight !== null;
  const body = step.task && !task ? (step.fallbackBody ?? step.body) : taskModalOpen && step.modalBody ? step.modalBody : step.body;

  return createPortal(
    <div data-tour-overlay="">
      {/* Catches every click, drag and right-click aimed at the app underneath */}
      {holed ? (
        backdropPanels(spotlight, frame).map((panel, i) => (
          <div
            key={i}
            aria-hidden="true"
            data-tour-backdrop="panel"
            className="pointer-events-auto fixed z-[60]"
            style={{ left: panel.left, top: panel.top, width: panel.width, height: panel.height }}
            onContextMenu={(e) => e.preventDefault()}
          />
        ))
      ) : (
        <div
          aria-hidden="true"
          data-tour-backdrop=""
          className={`pointer-events-auto fixed inset-0 z-[60] ${spotlight ? '' : 'bg-black/70'}`}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}
      {spotlight && (
        // The ring, the dim around it and the pulse are styled in globals.css
        // (`[data-tour-spotlight]`). It follows its target frame by frame and never eases: its dim
        // is one very large shadow, and animating the size or the corner radius of that repaints
        // the whole popup on every frame. Only the small action ring glides.
        <div
          aria-hidden="true"
          data-tour-spotlight={regionStyle}
          className="pointer-events-none fixed z-[60]"
          style={{ left: spotlight.left, top: spotlight.top, width: spotlight.width, height: spotlight.height, borderRadius: radius }}
        >
          {pulse && (
            <span
              data-tour-pulse=""
              style={
                {
                  borderRadius: radius + ringExtent,
                  '--tour-pulse-x': pulse.x,
                  '--tour-pulse-y': pulse.y
                } as React.CSSProperties
              }
            />
          )}
        </div>
      )}
      {action && (
        // The action ring: decorative (the text names the control), above every menu and dialog,
        // and never in the way of the pointer. It follows its control frame by frame.
        <div
          aria-hidden="true"
          data-tour-action=""
          data-tour-glide={glide.on ? '' : undefined}
          className="pointer-events-none fixed z-[60]"
          style={{ left: action.left, top: action.top, width: action.width, height: action.height, borderRadius: actionRadius }}
        >
          {actionPulse && (
            <span
              data-tour-pulse=""
              style={
                {
                  borderRadius: actionRadius + actionExtent,
                  '--tour-pulse-x': actionPulse.x,
                  '--tour-pulse-y': actionPulse.y
                } as React.CSSProperties
              }
            />
          )}
        </div>
      )}
      {drop && (
        // Where a dragged item goes. Decorative like the rings: the card's sub-step line says the
        // same in words (it quotes the label). Drawn above everything, the copy of the item that
        // follows the pointer included, so neither that copy nor a hover highlight can hide it.
        <div
          aria-hidden="true"
          data-tour-drop={`${dropBelow ? 'line' : ''}${dragPhase > 1 ? (dropBelow ? '-live' : 'live') : ''}`}
          className="pointer-events-none fixed"
          style={{ left: drop.left, top: drop.top, width: drop.width, height: drop.height, borderRadius: dropBelow ? 0 : dropRadius, zIndex: DROP_MARKER_Z }}
        >
          <span data-tour-drop-label={dropLabelPlace}>
            <span data-tour-drop-arrow="" />
            {targets?.dropLabel ?? t('tour.drop.default')}
          </span>
          {dropPulse && (
            <span
              data-tour-pulse=""
              style={
                {
                  borderRadius: dropRadius + tourRemToPx(0.25),
                  '--tour-pulse-x': dropPulse.x,
                  '--tour-pulse-y': dropPulse.y
                } as React.CSSProperties
              }
            />
          )}
        </div>
      )}
      <TourCard
        ref={cardRef}
        step={step}
        body={body}
        introducesChapter={introducesChapter}
        compact={taskModalOpen}
        wide={wideCard}
        progress={tourProgress(steps ?? [], index, TOUR_CHAPTERS)}
        position={position}
        taskStatus={taskStatus}
        subStep={subStep}
        practice={
          practiceRemoved
            ? { name: '', tabCount: 0, removed: true }
            : practice
              ? { name: practice.name, tabCount: getGroupTabCount(practice), removed: false }
              : null
        }
        onNext={next}
        onBack={back}
        onSkip={skip}
        onSkipStep={skipStep}
        onSkipChapter={chapterTarget === -1 ? undefined : skipChapter}
        onRemovePractice={() => {
          if (!practice) return;
          removePracticeGroup(practice.id);
          setPracticeRemoved(true);
        }}
      />
    </div>,
    document.body
  );
}
