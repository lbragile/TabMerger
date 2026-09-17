import { showDndDebugChip } from './dndDebug';

/**
 * DIAGNOSTIC ONLY — flag-gated pointer-stream probe for the MV3 toolbar popup.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * A `grabbing` cursor during a drag is impossible with the shipped native HTML5
 * drag (the OS owns the cursor for a native drag session). The only route to it
 * is a pointer-events-driven drag, which was abandoned because the real toolbar
 * popup appeared to withhold the pointer stream after `pointerdown`. That
 * conclusion rested on thin evidence: the old instrumentation logged only the
 * FIRST move, never counted later ones, never separated `pointercancel` /
 * `lostpointercapture` / `pointerup`, and never looked at `mousemove`,
 * `pointerrawupdate` or `getCoalescedEvents()`. CDP-synthesized input cannot
 * reproduce hardware-input behaviour, so a human has to run this.
 *
 * ── Contract ─────────────────────────────────────────────────────────────────
 * Flag: `localStorage.tm_dnd_pointer_probe === '1'`, read when the popup opens.
 * UNSET (every real user): {@link installDndPointerProbe} returns immediately
 * without adding a single listener, grips stay `draggable`, and the HTML5 drag
 * sensor stays registered — zero behaviour change.
 * SET: grips are NOT `draggable` (a native drag would cancel the pointer stream
 * and pollute the measurement) and `useDndSensors` leaves out `Html5DragSensor`,
 * so pressing a grip starts no drag at all. For each press on a grip the probe
 * records counts of `pointermove` / `pointerrawupdate` / `mousemove` on both
 * `document` (capture) and `window`, summed `getCoalescedEvents().length`, the
 * timestamps of `gotpointercapture` / `pointercancel` / `lostpointercapture` /
 * `pointerup` / `mouseup`, the max distance from the press origin, and the
 * duration. Presses alternate between NO pointer capture (odd) and
 * `setPointerCapture` on the pressed grip (even). On release it emits ONE line
 * `[tm-dnd-probe] {...}` to the console and to the corner chip (selectable, so
 * it can be copied without devtools), and keeps the last 10 lines in
 * `localStorage.tm_dnd_pointer_probe_log`.
 */

export const DND_POINTER_PROBE_FLAG = 'tm_dnd_pointer_probe';
export const DND_POINTER_PROBE_LOG_KEY = 'tm_dnd_pointer_probe_log';

/** Fresh read of the probe flag. Never throws. */
export function readDndPointerProbeFlag(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DND_POINTER_PROBE_FLAG) === '1';
  } catch {
    return false;
  }
}

/**
 * The flag as of popup load. Components and `useDndSensors` read this constant so
 * the gating is fixed for the popup's lifetime (the user reopens the popup after
 * flipping the flag).
 */
export const DND_POINTER_PROBE_ACTIVE: boolean = readDndPointerProbeFlag();

const GRIP_SELECTOR = '[aria-label^="Drag to reorder"]';
/** Grace period after `pointerup`/`mouseup` so trailing `lostpointercapture`/`mouseup` are counted. */
const SETTLE_MS = 80;
/** Hard stop if no release event ever arrives (e.g. the popup closed mid-press). */
const MAX_PRESS_MS = 20_000;

type MoveType = 'pointermove' | 'pointerrawupdate' | 'mousemove';
const MOVE_TYPES: MoveType[] = ['pointermove', 'pointerrawupdate', 'mousemove'];
const LIFECYCLE_TYPES = ['gotpointercapture', 'pointercancel', 'lostpointercapture', 'pointerup', 'mouseup'] as const;

interface MoveStats {
  doc: number;
  win: number;
  /** ms after press of the first / last `document`-capture event, and the largest gap between them. */
  firstMs: number | null;
  lastMs: number | null;
  maxGapMs: number;
}

export interface DndPointerProbeSummary {
  press: number;
  mode: 'no-capture' | 'capture';
  grip: string | null;
  pointerType: string;
  captureSet: boolean | null;
  hasCaptureAfterSet: boolean | null;
  captureError: string | null;
  durationMs: number;
  maxDistPx: number;
  pointermove: MoveStats;
  pointerrawupdate: MoveStats;
  mousemove: MoveStats;
  coalescedPointermove: number;
  coalescedRawupdate: number;
  lifecycle: Array<[string, number]>;
  selectstartBlocked: number;
  dragstartBlocked: number;
  endedBy: string;
}

type AnyListener = (e: Event) => void;

function emptyStats(): MoveStats {
  return { doc: 0, win: 0, firstMs: null, lastMs: null, maxGapMs: 0 };
}

function coalescedCount(e: Event): number {
  const fn = (e as PointerEvent).getCoalescedEvents;
  if (typeof fn !== 'function') return 0;
  try {
    return fn.call(e).length;
  } catch {
    return 0;
  }
}

function persistLine(line: string): string[] {
  let lines: string[] = [];
  try {
    const prev = JSON.parse(localStorage.getItem(DND_POINTER_PROBE_LOG_KEY) ?? '[]');
    if (Array.isArray(prev)) lines = prev.filter((l): l is string => typeof l === 'string');
  } catch {
    /* corrupt / unavailable — start fresh */
  }
  lines = [...lines, line].slice(-10);
  try {
    localStorage.setItem(DND_POINTER_PROBE_LOG_KEY, JSON.stringify(lines));
  } catch {
    /* ignore */
  }
  return lines;
}

/**
 * Install the probe. A no-op returning a no-op disposer unless the flag is set
 * (or `opts.enabled` forces it, for tests). Safe to call once at popup boot.
 */
export function installDndPointerProbe(
  opts: { enabled?: boolean; doc?: Document; win?: Window } = {}
): () => void {
  const enabled = opts.enabled ?? readDndPointerProbeFlag();
  if (!enabled || typeof document === 'undefined') return () => {};
  const doc = opts.doc ?? document;
  const win = opts.win ?? window;

  let pressCount = 0;
  let active: { abort: () => void } | null = null;

  const onPointerDown = (ev: Event) => {
    const e = ev as PointerEvent;
    if (active || (typeof e.button === 'number' && e.button !== 0)) return;
    const target = e.target instanceof Element ? e.target : null;
    const grip = target?.closest(GRIP_SELECTOR) ?? null;
    if (!grip) return;
    pressCount += 1;
    active = startPress(grip, e, pressCount, doc, win, () => {
      active = null;
    });
  };

  doc.addEventListener('pointerdown', onPointerDown, true);
  return () => {
    doc.removeEventListener('pointerdown', onPointerDown, true);
    active?.abort();
    active = null;
  };
}

function startPress(
  grip: Element,
  down: PointerEvent,
  press: number,
  doc: Document,
  win: Window,
  onDone: () => void
): { abort: () => void } {
  const t0 = performance.now();
  const rel = () => Math.round(performance.now() - t0);
  const originX = typeof down.clientX === 'number' ? down.clientX : 0;
  const originY = typeof down.clientY === 'number' ? down.clientY : 0;
  const mode: DndPointerProbeSummary['mode'] = press % 2 === 1 ? 'no-capture' : 'capture';

  const stats: Record<MoveType, MoveStats> = {
    pointermove: emptyStats(),
    pointerrawupdate: emptyStats(),
    mousemove: emptyStats()
  };
  const summary: Omit<DndPointerProbeSummary, MoveType | 'durationMs' | 'endedBy'> = {
    press,
    mode,
    grip: grip.getAttribute('aria-label'),
    pointerType: down.pointerType ?? 'unknown',
    captureSet: null,
    hasCaptureAfterSet: null,
    captureError: null,
    maxDistPx: 0,
    coalescedPointermove: 0,
    coalescedRawupdate: 0,
    lifecycle: [],
    selectstartBlocked: 0,
    dragstartBlocked: 0
  };

  const bound: Array<[EventTarget, string, AnyListener, boolean]> = [];
  const bind = (target: EventTarget, type: string, fn: AnyListener, capture: boolean) => {
    target.addEventListener(type, fn, capture);
    bound.push([target, type, fn, capture]);
  };

  const trackDistance = (e: Event) => {
    const me = e as MouseEvent;
    if (typeof me.clientX !== 'number') return;
    const d = Math.hypot(me.clientX - originX, me.clientY - originY);
    if (d > summary.maxDistPx) summary.maxDistPx = Math.round(d);
  };

  for (const type of MOVE_TYPES) {
    bind(
      doc,
      type,
      (e) => {
        const s = stats[type];
        const t = rel();
        s.doc += 1;
        s.maxGapMs = Math.max(s.maxGapMs, t - (s.lastMs ?? 0));
        if (s.firstMs === null) s.firstMs = t;
        s.lastMs = t;
        if (type === 'pointermove') summary.coalescedPointermove += coalescedCount(e);
        if (type === 'pointerrawupdate') summary.coalescedRawupdate += coalescedCount(e);
        trackDistance(e);
      },
      true
    );
    bind(
      win,
      type,
      () => {
        stats[type].win += 1;
      },
      false
    );
  }

  let finished = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const finish = (endedBy: string) => {
    if (finished) return;
    finished = true;
    if (settleTimer) clearTimeout(settleTimer);
    clearTimeout(maxTimer);
    for (const [target, type, fn, capture] of bound) target.removeEventListener(type, fn, capture);
    const full: DndPointerProbeSummary = { ...summary, ...stats, durationMs: rel(), endedBy };
    const line = `[tm-dnd-probe] ${JSON.stringify(full)}`;
    try {
      // eslint-disable-next-line no-console
      console.log(line);
    } catch {
      /* ignore */
    }
    const lines = persistLine(line);
    try {
      showDndDebugChip(lines.slice(-2).join('\n'), { selectable: true });
    } catch {
      /* ignore */
    }
    onDone();
  };
  const settle = (endedBy: string) => {
    if (finished || settleTimer) return;
    settleTimer = setTimeout(() => finish(endedBy), SETTLE_MS);
  };

  for (const type of LIFECYCLE_TYPES) {
    bind(
      doc,
      type,
      () => {
        summary.lifecycle.push([type, rel()]);
        if (type === 'pointerup' || type === 'mouseup') settle(type);
      },
      true
    );
  }
  // Block text selection / any native drag for the duration of the press so the
  // measured stream isn't cut short by a selection drag (dnd-kit's pointer
  // sensors do the same once active).
  bind(doc, 'selectstart', (e) => {
    summary.selectstartBlocked += 1;
    e.preventDefault();
  }, true);
  bind(doc, 'dragstart', (e) => {
    summary.dragstartBlocked += 1;
    e.preventDefault();
  }, true);

  const maxTimer = setTimeout(() => finish('timeout'), MAX_PRESS_MS);

  if (mode === 'capture') {
    const el = grip as Element & {
      setPointerCapture?: (id: number) => void;
      hasPointerCapture?: (id: number) => boolean;
    };
    try {
      if (typeof el.setPointerCapture !== 'function') throw new Error('setPointerCapture unavailable');
      el.setPointerCapture(down.pointerId);
      summary.captureSet = true;
      summary.hasCaptureAfterSet =
        typeof el.hasPointerCapture === 'function' ? el.hasPointerCapture(down.pointerId) : null;
    } catch (err) {
      summary.captureSet = false;
      summary.captureError = String(err);
    }
  }

  return { abort: () => finish('aborted') };
}
