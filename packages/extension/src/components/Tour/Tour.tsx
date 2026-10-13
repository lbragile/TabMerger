import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '@/stores/uiStore';
import { useGroups, useDeleteGroup } from '@/hooks/useGroups';
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
  spotlightRect,
  tourProgress,
  type TourStep
} from '@/lib/tour';
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
import { activeTourTask, findNewGroup, findPracticeGroup, readOnlyTargets, type TourTaskContext } from '@/lib/tourTasks';
import { AI_ENABLED } from '@/lib/aiFlag';
import { getGroupTabCount } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { trackEvent } from '@/lib/analytics';
import type { Group } from '@/lib/types';
import { TourCard, type TourTaskStatus } from './TourCard';

// Sizes in rem, converted to pixels where the positioning maths needs them
const SPOTLIGHT_PADDING_REM = 0.25;
const CARD_GAP_REM = 1;
const FRAME_MARGIN_REM = 0.5;
/** How far the ring is drawn outside the cut-out: inner line + accent ring + outer line (see globals.css). */
const RING_EXTENT_REM = 0.375;
/** How far the pulse travels beyond the ring. */
const PULSE_TRAVEL_REM = 0.25;
/** The cut-out keeps this far from the popup frame, so the ring and its pulse are never clipped. */
const FRAME_EDGE_REM = RING_EXTENT_REM + PULSE_TRAVEL_REM;
/** Smallest corner radius of the ring: the popup's controls are square, this only softens the corners. */
const MIN_RADIUS_REM = 0.125;
// The action ring: the tight ring on the ONE control to act on next (see globals.css,
// `[data-tour-action]`). Closer to its control and thinner than the region ring.
const ACTION_PADDING_REM = 0.1875;
/** Inner line + accent ring + outer line. */
const ACTION_RING_EXTENT_REM = 0.25;
/** The action ring's cut-out keeps this far from the popup frame: ring + pulse, never clipped. */
const ACTION_FRAME_EDGE_REM = ACTION_RING_EXTENT_REM + PULSE_TRAVEL_REM;

/** How long after a task completes focus is still handed back to the card (a closing popover refocuses its trigger late). */
const HAND_BACK_MS = 500;

/** Id of the toast that offers to remove the practice group after a skipped tour. */
const PRACTICE_TOAST_ID = 'tour-practice-group';

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

  // Remember the step (and the practice group) so the tour resumes here after the popup closes
  const practiceId = practice?.id ?? null;
  useEffect(() => {
    if (currentId) void saveTourProgress(currentId, practiceId);
  }, [currentId, practiceId]);

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
  // The action ring: only while the task is still to do
  const actionLists = taskStatus === 'todo' ? (targets?.action ?? NO_ACTION) : NO_ACTION;
  const actionTarget = useTourHighlight(actionLists, `${currentId ?? ''}:action`, drawn && actionLists.length > 0);
  const action = useMemo(
    () =>
      actionTarget
        ? spotlightRect(actionTarget.rect, tourRemToPx(ACTION_PADDING_REM), tourFrame(), tourRemToPx(ACTION_FRAME_EDGE_REM))
        : null,
    [actionTarget]
  );

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
    const avoid = action && {
      left: action.left - extent,
      top: action.top - extent,
      width: action.width + extent * 2,
      height: action.height + extent * 2
    };
    const { left, top } = cardPositionAvoiding(beside, size, tourFrame(), tourRemToPx(FRAME_MARGIN_REM), avoid);
    setPosition((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    // `taskStatus`, the chapter header and the practice offer change the card's height
  }, [spotlight, action, step, taskModalOpen]);
  useLayoutEffect(() => {
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [place, taskStatus, practiceRemoved, introducesChapter, drawn]);

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
  const handBackUntil = useRef(0);
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
    handBackUntil.current = performance.now() + HAND_BACK_MS;
    handBack();
  }, [taskStatus, handBack]);
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
  useTourFrame(() => {
    relock();
    if (performance.now() < handBackUntil.current) handBack();
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
  const regionStyle = !action ? '' : spotlight && rectsCoincide(spotlight, action, tourRemToPx(RING_EXTENT_REM)) ? 'merged' : 'calm';
  const pulse = spotlight && !action
    ? pulseScale({ width: spotlight.width + ringExtent * 2, height: spotlight.height + ringExtent * 2 }, tourRemToPx(PULSE_TRAVEL_REM))
    : null;
  // An interactive step leaves a hole in the click-catcher over what it highlights
  const holed = taskStatus !== 'none' && spotlight !== null;
  const body = step.task && !task ? (step.fallbackBody ?? step.body) : step.body;

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
        // (`[data-tour-spotlight]`). No transition on the position: it follows its target frame
        // by frame, and easing would make it trail behind.
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
      <TourCard
        ref={cardRef}
        step={step}
        body={body}
        introducesChapter={introducesChapter}
        progress={tourProgress(steps ?? [], index, TOUR_CHAPTERS)}
        position={position}
        taskStatus={taskStatus}
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
