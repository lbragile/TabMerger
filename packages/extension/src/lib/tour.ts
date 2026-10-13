/**
 * Guided tour of the popup: the stored flag (shared by the background worker and the popup)
 * and the pure geometry used to place the spotlight and the card. No React in here, so every
 * function can be unit-tested on its own. The steps themselves live in `tourSteps.ts`, the UI
 * in `components/Tour/Tour.tsx`.
 *
 * Stored record (`chrome.storage.local`, key {@link TOUR_STORAGE_KEY}):
 *  - absent: never start by itself (an existing user after an update, a cleared profile)
 *  - `{ status: 'pending' }`: start on the next popup open (written on a first install)
 *  - `{ status: 'pending', stepId }`: a tour is under way, resume at that step
 *  - `{ status: 'done' }`: finished or skipped, never start by itself again
 *
 * `chrome.storage.local` and not the popup's IndexedDB settings on purpose: "Clear all data"
 * wipes those settings, and the service worker needs to write the flag without the popup.
 */

export const TOUR_STORAGE_KEY = 'tm_tour';

export type TourStatus = 'pending' | 'done';

export interface TourRecord {
  status: TourStatus;
  /** Step the user was on when the popup last closed. Only meaningful while `pending`. */
  stepId?: string;
  /**
   * Id of the group the user made in the tour's "make a group" step, while it may still exist.
   * Kept on a `done` record too: a replay reuses that group instead of asking for another one,
   * and the tour can offer to remove it when it ends.
   */
  practiceGroupId?: string;
}

const isStoredId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 64;

/** Validates what came out of storage; anything unexpected reads as "no record". */
export function parseTourRecord(raw: unknown): TourRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { status, stepId, practiceGroupId } = raw as { status?: unknown; stepId?: unknown; practiceGroupId?: unknown };
  if (status !== 'done' && status !== 'pending') return null;
  const record: TourRecord = { status };
  if (status === 'pending' && isStoredId(stepId)) record.stepId = stepId;
  if (isStoredId(practiceGroupId)) record.practiceGroupId = practiceGroupId;
  return record;
}

function storageArea(): chrome.storage.StorageArea | null {
  try {
    return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
  } catch {
    return null;
  }
}

/** Reads the stored record. Never throws: no storage, or a failed read, is "no record". */
export async function readTourRecord(): Promise<TourRecord | null> {
  const area = storageArea();
  if (!area) return null;
  try {
    const stored = await area.get(TOUR_STORAGE_KEY);
    return parseTourRecord(stored?.[TOUR_STORAGE_KEY]);
  } catch {
    return null;
  }
}

async function writeTourRecord(record: TourRecord): Promise<void> {
  const area = storageArea();
  if (!area) return;
  try {
    await area.set({ [TOUR_STORAGE_KEY]: record });
  } catch {
    // Best effort: a failed write only means the tour may start again next time
  }
}

/** Demo builds record the popup for marketing videos: the tour must not cover it. */
export function isTourAutoStartEnabled(): boolean {
  return import.meta.env.VITE_DEMO_BUILD !== 'true';
}

/**
 * Called by the background worker's `onInstalled` listener. Marks the tour pending on a
 * first install only: an update, a browser update or a shared-module update never does, so
 * existing users are not shown the tour after upgrading. Never overwrites an existing record.
 * Returns whether it wrote the flag.
 */
export async function markTourPendingOnInstall(reason: string): Promise<boolean> {
  if (reason !== 'install' || !isTourAutoStartEnabled()) return false;
  if (await readTourRecord()) return false;
  await writeTourRecord({ status: 'pending' });
  return true;
}

/** True when the popup should start the tour by itself for this record. */
export function shouldAutoStartTour(record: TourRecord | null): boolean {
  return isTourAutoStartEnabled() && record?.status === 'pending';
}

const withPractice = (record: TourRecord, practiceGroupId?: string | null): TourRecord =>
  isStoredId(practiceGroupId) ? { ...record, practiceGroupId } : record;

/** Remembers the step being shown, so the tour resumes there after the popup closes. */
export function saveTourProgress(stepId: string, practiceGroupId?: string | null): Promise<void> {
  return writeTourRecord(withPractice({ status: 'pending', stepId }, practiceGroupId));
}

/**
 * Finished or skipped: the tour never starts by itself again. Pass the practice group's id
 * while that group still exists, so a replay reuses it.
 */
export function markTourDone(practiceGroupId?: string | null): Promise<void> {
  return writeTourRecord(withPractice({ status: 'done' }, practiceGroupId));
}

// ── Steps ────────────────────────────────────────────────────────────────────────────────

/** Where the card sits relative to its anchor. `center` = no anchor, middle of the popup. */
export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

/** A "do it yourself" step. What each one watches and unlocks is in `tourTasks.ts`. */
export type TourTaskId = 'make-group' | 'group-colour' | 'group-pin' | 'search' | 'theme';

export interface TourStep {
  /** Stable id: stored as progress and sent with analytics, so do not rename casually. */
  id: string;
  /** Id of the chapter the step belongs to ({@link TourChapter}). A chapter's steps are adjacent. */
  chapter: string;
  /** Value of the `data-tour` attribute on the real control, or `null` for a centered step. */
  anchor: string | null;
  /** More `data-tour` names highlighted together with `anchor` (one ring around all of them). */
  anchorExtra?: readonly string[];
  title: string;
  body: string;
  placement: TourPlacement;
  /** Makes the step interactive: the user does the thing, and only then is Next offered. */
  task?: TourTaskId;
  /** Shown once the task is done ("Nice, colour changed."). */
  doneText?: string;
  /** Text used instead of `body` when the task cannot be offered (the step is then read-only). */
  fallbackBody?: string;
  /** Group to show in the main panel while the step is up. */
  activate?: 'now-open';
  /** Only shown when this feature is switched on in the build. */
  when?: 'ai';
}

export interface TourChapter {
  id: string;
  /** Shown at the top of the card on every step of the chapter. */
  title: string;
  /** One sentence: what the chapter covers and what the user will try in it. */
  description: string;
}

/** What is switched on for this user, for {@link availableTourSteps}. */
export interface TourEnvironment {
  aiEnabled: boolean;
}

/** CSS selector for the element carrying `data-tour="<name>"`. */
export function tourAnchorSelector(name: string): string {
  return `[data-tour="${name}"]`;
}

/**
 * Drops the steps this user cannot be shown: a feature that is switched off (`when`), or a
 * read-only step whose anchor is not on the page (a control hidden for this user), so the tour
 * never points at nothing. Centered steps always stay. Interactive steps stay too: their
 * targets appear as the user goes (a menu, a new group), and a step with nothing to point at
 * is drawn in the middle of the popup.
 */
export function availableTourSteps(
  steps: readonly TourStep[],
  root: ParentNode,
  env: TourEnvironment = { aiEnabled: false }
): TourStep[] {
  return steps.filter((step) => {
    if (step.when === 'ai' && !env.aiEnabled) return false;
    if (step.anchor === null || step.task) return true;
    return root.querySelector(tourAnchorSelector(step.anchor)) !== null;
  });
}

export interface TourProgress {
  /** One-based position among all the steps shown. */
  step: number;
  total: number;
  /** One-based position of the step's chapter among the chapters that still have steps. */
  chapter: number;
  chapters: number;
  chapterTitle: string;
  chapterDescription: string;
  /** One-based position inside the chapter. */
  stepInChapter: number;
  stepsInChapter: number;
}

/** "Chapter x of y, step n of m" for the step at `index`. Chapters with no steps left are not counted. */
export function tourProgress(steps: readonly TourStep[], index: number, chapters: readonly TourChapter[]): TourProgress {
  const order = steps.map((s) => s.chapter).filter((id, i, all) => all.indexOf(id) === i);
  const current = steps[index]?.chapter ?? order[0] ?? '';
  const inChapter = steps.filter((s) => s.chapter === current);
  const chapter = chapters.find((c) => c.id === current);
  return {
    step: index + 1,
    total: steps.length,
    chapter: Math.max(1, order.indexOf(current) + 1),
    chapters: order.length,
    chapterTitle: chapter?.title ?? '',
    chapterDescription: chapter?.description ?? '',
    stepInChapter: Math.max(1, inChapter.indexOf(steps[index]) + 1),
    stepsInChapter: inChapter.length
  };
}

/** Index of the first step of the chapter after the one `index` is in, or -1 in the last chapter. */
export function nextChapterIndex(steps: readonly TourStep[], index: number): number {
  const current = steps[index]?.chapter;
  for (let i = index + 1; i < steps.length; i++) if (steps[i].chapter !== current) return i;
  return -1;
}

/** Index to start at: the remembered step when it still exists, otherwise the first one. */
export function resolveTourStartIndex(steps: readonly TourStep[], stepId: string | null | undefined): number {
  if (!stepId) return 0;
  const index = steps.findIndex((step) => step.id === stepId);
  return index === -1 ? 0 : index;
}

// ── Geometry ─────────────────────────────────────────────────────────────────────────────

export interface TourRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TourSize {
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** Root font size in pixels: sizes are authored in rem and converted where maths needs pixels. */
export function remToPx(rem: number, rootFontSize = 16): number {
  return rem * rootFontSize;
}

/**
 * The spotlight cut-out: the anchor grown by `padding` on every side, then kept `edge` away
 * from the popup frame. `edge` is how far the ring and its pulse are drawn OUTSIDE the cut-out,
 * so for an anchor that touches the frame (the sidebar at x = 0, the header) the ring moves
 * inwards instead of being cut off.
 */
export function spotlightRect(anchor: TourRect, padding: number, frame: TourSize, edge = 0): TourRect {
  const left = clamp(anchor.left - padding, edge, frame.width - edge);
  const top = clamp(anchor.top - padding, edge, frame.height - edge);
  const right = clamp(anchor.left + anchor.width + padding, left, frame.width - edge);
  const bottom = clamp(anchor.top + anchor.height + padding, top, frame.height - edge);
  return { left, top, width: right - left, height: bottom - top };
}

/** The part of `a` that lies inside `b`, or `null` when they do not overlap. */
export function intersectRects(a: TourRect, b: TourRect): TourRect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

/** Smallest rectangle holding every rectangle given, or `null` for none. */
export function unionRects(rects: readonly TourRect[]): TourRect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * The four rectangles around `hole` that together cover the rest of the frame. They catch
 * clicks aimed at the app while leaving the highlighted control reachable.
 */
export function backdropPanels(hole: TourRect, frame: TourSize): TourRect[] {
  const right = hole.left + hole.width;
  const bottom = hole.top + hole.height;
  return [
    { left: 0, top: 0, width: frame.width, height: Math.max(0, hole.top) },
    { left: 0, top: bottom, width: frame.width, height: Math.max(0, frame.height - bottom) },
    { left: 0, top: hole.top, width: Math.max(0, hole.left), height: hole.height },
    { left: right, top: hole.top, width: Math.max(0, frame.width - right), height: hole.height }
  ];
}

/**
 * How much the pulse ring has to grow on each axis to move `travel` pixels outwards on every
 * side, whatever the shape of the highlight (a single `scale()` number would move the short
 * sides of a wide row much further than its long sides).
 */
export function pulseScale(size: TourSize, travel: number): { x: number; y: number } {
  const grow = (length: number) => (length > 0 ? (length + travel * 2) / length : 1);
  return { x: grow(size.width), y: grow(size.height) };
}

export interface CardPositionInput {
  /** Spotlight rectangle, or `null` for a centered step. */
  anchor: TourRect | null;
  card: TourSize;
  frame: TourSize;
  placement: TourPlacement;
  /** Space between the spotlight and the card. */
  gap: number;
  /** Smallest distance kept between the card and the edge of the popup. */
  margin: number;
  /**
   * Where the card goes when no side of the anchor has room (a dialog that fills most of the
   * popup): that corner of the FRAME. Default: inside the anchor's bottom right corner.
   */
  fallbackCorner?: 'bottom-left' | 'top-left';
}

export interface CardPosition {
  left: number;
  top: number;
  /** Where the card ended up. `inside` = no side had room, so it sits inside the anchor. */
  placement: TourPlacement | 'inside';
}

const OPPOSITE: Record<Exclude<TourPlacement, 'center'>, Exclude<TourPlacement, 'center'>> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left'
};

/**
 * Places the card next to the spotlight and always fully inside the popup frame.
 *
 * Tries the requested side, then the opposite one, then the two remaining sides. A side "fits"
 * when the card has room there without covering the spotlight; along the other axis the card is
 * centered on the anchor and clamped to the frame. When no side fits (an anchor that fills most
 * of the popup) the card goes in the anchor's bottom-right corner.
 */
export function computeCardPosition({ anchor, card: measured, frame, placement, gap, margin, fallbackCorner }: CardPositionInput): CardPosition {
  // A card can never be drawn larger than the frame minus its margins (CSS caps it the same
  // way), so a taller or wider measurement is cut to that before any maths
  const card = {
    width: Math.min(measured.width, Math.max(0, frame.width - margin * 2)),
    height: Math.min(measured.height, Math.max(0, frame.height - margin * 2))
  };
  const maxLeft = frame.width - card.width - margin;
  const maxTop = frame.height - card.height - margin;
  if (!anchor || placement === 'center') {
    return {
      left: clamp((frame.width - card.width) / 2, margin, maxLeft),
      top: clamp((frame.height - card.height) / 2, margin, maxTop),
      placement: 'center'
    };
  }

  const alignedLeft = clamp(anchor.left + anchor.width / 2 - card.width / 2, margin, maxLeft);
  const alignedTop = clamp(anchor.top + anchor.height / 2 - card.height / 2, margin, maxTop);
  const candidates: Record<Exclude<TourPlacement, 'center'>, { left: number; top: number; fits: boolean }> = {
    right: {
      left: anchor.left + anchor.width + gap,
      top: alignedTop,
      fits: anchor.left + anchor.width + gap <= maxLeft
    },
    left: {
      left: anchor.left - gap - card.width,
      top: alignedTop,
      fits: anchor.left - gap - card.width >= margin
    },
    bottom: {
      left: alignedLeft,
      top: anchor.top + anchor.height + gap,
      fits: anchor.top + anchor.height + gap <= maxTop
    },
    top: {
      left: alignedLeft,
      top: anchor.top - gap - card.height,
      fits: anchor.top - gap - card.height >= margin
    }
  };

  const others = (['bottom', 'right', 'top', 'left'] as const).filter((p) => p !== placement && p !== OPPOSITE[placement]);
  for (const side of [placement, OPPOSITE[placement], ...others]) {
    const candidate = candidates[side];
    if (candidate.fits) return { left: candidate.left, top: candidate.top, placement: side };
  }

  if (fallbackCorner) {
    return { left: margin, top: fallbackCorner === 'top-left' ? margin : Math.max(margin, maxTop), placement: 'inside' };
  }

  return {
    left: clamp(anchor.left + anchor.width - card.width - gap, margin, maxLeft),
    top: clamp(anchor.top + anchor.height - card.height - gap, margin, maxTop),
    placement: 'inside'
  };
}

/** True when two rectangles overlap by more than a shared edge. */
export function rectsOverlap(a: TourRect, b: TourRect): boolean {
  return intersectRects(a, b) !== null;
}

/**
 * True when `a` and `b` are the same rectangle to within `tolerance` pixels on every
 * side: the action ring and the region spotlight would then be drawn on top of each other.
 */
export function rectsCoincide(a: TourRect, b: TourRect, tolerance: number): boolean {
  return (
    Math.abs(a.left - b.left) <= tolerance &&
    Math.abs(a.top - b.top) <= tolerance &&
    Math.abs(a.left + a.width - (b.left + b.width)) <= tolerance &&
    Math.abs(a.top + a.height - (b.top + b.height)) <= tolerance
  );
}

/**
 * Moves the card off a rectangle it must not cover (the control the action ring is on, grown
 * by the ring). `position` is kept when it is already clear. Otherwise the card goes to the
 * first corner of the frame that is clear, starting with the corner nearest to where it was,
 * so it moves as little as possible; when every corner covers `avoid` (it cannot happen for a
 * control much smaller than the popup) `position` is kept.
 */
export function cardPositionAvoiding(
  position: { left: number; top: number },
  card: TourSize,
  frame: TourSize,
  margin: number,
  avoid: TourRect | null
): { left: number; top: number } {
  const covers = (p: { left: number; top: number }) => !!avoid && rectsOverlap({ ...p, ...card }, avoid);
  if (!covers(position)) return position;
  const maxLeft = Math.max(margin, frame.width - card.width - margin);
  const maxTop = Math.max(margin, frame.height - card.height - margin);
  const corners = [
    { left: margin, top: margin },
    { left: maxLeft, top: margin },
    { left: margin, top: maxTop },
    { left: maxLeft, top: maxTop }
  ];
  const distance = (p: { left: number; top: number }) => Math.abs(p.left - position.left) + Math.abs(p.top - position.top);
  return corners.sort((a, b) => distance(a) - distance(b)).find((corner) => !covers(corner)) ?? position;
}

/**
 * New `scrollTop` for a scroll container so `anchor` is fully visible inside it, or `null`
 * when it already is. Both rectangles are viewport rectangles (`getBoundingClientRect`). An
 * anchor taller than the container is aligned to its top.
 */
export function scrollTopToReveal(
  anchor: Pick<TourRect, 'top' | 'height'>,
  container: Pick<TourRect, 'top' | 'height'>,
  scrollTop: number,
  padding = 0
): number | null {
  const above = anchor.top - padding - container.top;
  const below = anchor.top + anchor.height + padding - (container.top + container.height);
  if (above >= 0 && below <= 0) return null;
  if (above < 0 || anchor.height + padding * 2 > container.height) return Math.max(0, scrollTop + above);
  return Math.max(0, scrollTop + below);
}

/** Index of the element Tab / Shift+Tab should focus next inside a focus trap of `count` items. */
export function nextTrapIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return (current + (backwards ? -1 : 1) + count) % count;
}
