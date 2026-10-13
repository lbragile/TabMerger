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
import {
  availableTourSteps,
  backdropPanels,
  cardPositionAvoiding,
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
  TOUR_DRAG_CHAPTER,
  type TourRect,
  type TourStep
} from '@/lib/tour';
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
  isInAllowed,
  isInForeignLayer,
  isTextEntry,
  lockTourApp,
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
/** Text-colour hairline + the thin secondary-colour line. */
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
/** How far around the destination a dragged item counts as "over it" (the third sub-step of a drag). */
const DROP_NEAR_REM = 0.25;
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

  // A popup that was closed in the middle of the drag chapter could not remove the practice
  // groups. Once per popup open: unless the tour is about to resume in that chapter (or is
  // already showing it), they go, so nobody is left with a stray "Tour demo" group.
  const removeTourDemo = useRemoveTourDemo();
  useEffect(() => {
    void readTourRecord().then((record) => {
      const resumesThere = shouldAutoStartTour(record) && chapterOfStep(record?.stepId) === TOUR_DRAG_CHAPTER;
      const ui = useUIStore.getState();
      const showingIt = ui.tourActive && chapterOfStep(ui.tourStepId) === TOUR_DRAG_CHAPTER;
      if (!resumesThere && !showingIt) removeTourDemo();
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
  const ctx: TourTaskContext = useMemo(
    () => ({
      groups,
      practiceGroupId,
      maxGroups,
      renamingGroupIndex: renameTarget?.kind === 'group' ? renameTarget.groupIndex : null,
      searchFilter,
      theme: settings?.theme ?? null,
      modalType,
      previewColor: previewGroupColor && previewGroupColor.groupId === practiceGroupId ? previewGroupColor.color : null
    }),
    [groups, practiceGroupId, maxGroups, renameTarget, searchFilter, settings?.theme, modalType, previewGroupColor]
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
  // Done stays done for this run, so Back onto a finished step does not ask for it again
  const [completed, setCompleted] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!liveDone || !currentId || completed.has(currentId)) return;
    // (also the guard that sends the event once per step, whether or not the result is remembered)
    setCompleted((prev) => new Set(prev).add(currentId));
    trackEvent('tour_task_done', { step_id: currentId });
  }, [liveDone, currentId, completed]);
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
    let cancelled = false;
    void readTourRecord().then((record) => {
      if (!cancelled && record?.practiceGroupId && !useUIStore.getState().tourPracticeGroupId) {
        setTourPracticeGroupId(record.practiceGroupId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [setTourPracticeGroupId]);

  // "Make a group": the group that was not there when the step was entered is the practice group
  const makeGroupBaseline = step?.task === 'make-group' && task && entry?.id === step.id ? (entry.baseline as string[]) : null;
  useEffect(() => {
    if (!makeGroupBaseline || practice) return;
    const fresh = findNewGroup(groups, makeGroupBaseline);
    if (fresh) setTourPracticeGroupId(fresh.id);
  }, [makeGroupBaseline, practice, groups, setTourPracticeGroupId]);

  // ── The practice ("Tour demo") groups of the drag chapter ───────────────────────────────
  // They exist exactly while a step of that chapter is up. Every step of the chapter makes sure
  // both are there when it opens, and puts a fresh set in place when what is left of them
  // cannot serve the step (the user moved every sample tab away, say): the user is never asked
  // to make anything first. Leaving the chapter, in any direction and by any button, or ending
  // the tour (this component unmounts) removes them.
  const qc = useQueryClient();
  const removeTourDemo = useRemoveTourDemo();
  const inDragChapter = step?.chapter === TOUR_DRAG_CHAPTER;
  const stepTaskId = step?.task;
  useEffect(() => {
    if (!inDragChapter || !currentId) return;
    void ensureTourDemoGroups().then(async (made) => {
      let result = made;
      const wanted = stepTaskId ? tourTask(stepTaskId) : null;
      if (wanted && !wanted.available({ ...ctx, groups: made.state.available })) result = await resetTourDemoGroups();
      if (result.changed) qc.setQueryData(GROUPS_QUERY_KEY, result.state);
    });
    // On entering each step of the chapter (`ctx` is only read for the plan and practice ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, inDragChapter]);
  useEffect(() => {
    if (!inDragChapter) return;
    return removeTourDemo;
  }, [inDragChapter, removeTourDemo]);

  // Remember the step (and the practice groups) so the tour resumes here after the popup closes
  const practiceId = practice?.id ?? null;
  useEffect(() => {
    if (currentId) void saveTourProgress(currentId, practiceId, inDragChapter ? TOUR_DEMO_GROUP_IDS : []);
  }, [currentId, practiceId, inDragChapter]);

  // Entering a step may pick the group shown; leaving one closes whatever it opened
  const leaveModal = task?.modal ?? null;
  const activate = step?.activate ?? null;
  const isSearchStep = step?.task === 'search';
  useEffect(() => {
    if (!currentId) return;
    if (activate === 'now-open') useUIStore.getState().setActiveGroupIndex(0);
    return () => {
      const ui = useUIStore.getState();
      // Menus, popovers, the colour picker and the search box (see `useCloseOnOverlayDismiss`)
      ui.dismissOverlays();
      if (leaveModal && ui.modal.type === leaveModal) ui.closeModal();
      if (isSearchStep) ui.setSearchFilter('');
    };
    // Per step, not per render: the values above are fixed for a given step
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

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
        toast(`The tour left a practice group, "${name}", in your list.`, {
          id: PRACTICE_TOAST_ID,
          duration: 12_000,
          action: { label: 'Remove it', onClick: () => removePracticeGroup(id) }
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
  // A cancelled drag is simply "nothing picked up" again.
  const isDragStep = taskStatus === 'todo' && !!targets?.dragOnly;
  const [dragPhaseRaw, setDragPhase] = useState<1 | 2 | 3>(1);
  const dragPhase = isDragStep ? dragPhaseRaw : 1;
  // The action ring: only while the task is still to do, and for a drag only until the item is
  // picked up (the destination's marker takes over from there)
  const actionLists = taskStatus === 'todo' && dragPhase === 1 ? (targets?.action ?? NO_ACTION) : NO_ACTION;
  const dropLists = taskStatus === 'todo' ? (targets?.drop ?? NO_ACTION) : NO_ACTION;
  const dropTarget = useTourHighlight(dropLists, `${currentId ?? ''}:drop`, drawn && dropLists.length > 0);
  const drop = useMemo(
    () => (dropTarget ? spotlightRect(dropTarget.rect, tourRemToPx(DROP_PADDING_REM), tourFrame(), tourRemToPx(DROP_FRAME_EDGE_REM)) : null),
    [dropTarget]
  );
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
  const place = useCallback(() => {
    const card = cardRef.current;
    if (!card || !step) return;
    const beside = computeCardPosition({
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
    // ...nor on a drag's destination, nor on what the task asks to keep readable (a setting's label)
    const avoid = [action, drop, keepClear?.rect ?? null].filter((rect): rect is TourRect => rect !== null).map(grown);
    const { left, top } = cardPositionAvoiding(beside, size, tourFrame(), tourRemToPx(FRAME_MARGIN_REM), avoid);
    setPosition((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    // `taskStatus`, the chapter header and the practice offer change the card's height
  }, [spotlight, action, drop, keepClear, step, taskModalOpen]);
  useLayoutEffect(() => {
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
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
    // A popover that closes as the task completes (the colour picker on "Apply") returns focus
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
        // each other would otherwise count as "over" the moment the item is picked up
        const x = ghost ? ghost.left + ghost.width / 2 : 0;
        const y = ghost ? ghost.top + ghost.height / 2 : 0;
        const over = !!box && !!ghost && ghost.width > 0 && x > box.left - near && x < box.right + near && y > box.top - near && y < box.bottom + near;
        if (destination && (over || destination.hasAttribute(MOVE_CURSOR_ATTR))) phase = 3;
      }
      setDragPhase((prev) => (prev === phase ? prev : phase));
    }
    // A drag step keeps its practice group in the main panel (a hover may have switched it)
    if (pinDemoGroup && !dragging) {
      const at = groups.findIndex((g) => g.id === TOUR_DEMO_MAIN_ID);
      if (at > 0 && useUIStore.getState().activeGroupIndex !== at) useUIStore.getState().setActiveGroupIndex(at);
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
        // Where a dragged item goes. Decorative like the rings: the text names the destination.
        <div
          aria-hidden="true"
          data-tour-drop={dragPhase > 1 ? 'live' : ''}
          className="pointer-events-none fixed z-[60]"
          style={{ left: drop.left, top: drop.top, width: drop.width, height: drop.height, borderRadius: dropRadius }}
        >
          <span data-tour-drop-label={drop.top < tourRemToPx(1.75) ? 'inside' : ''}>Drop here</span>
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
