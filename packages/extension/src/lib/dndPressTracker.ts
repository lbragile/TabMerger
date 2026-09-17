/**
 * Per-press pointer-stream evidence, and the runtime choice between the two drag
 * paths the popup supports.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The popup shipped a NATIVE HTML5 drag (`Html5DragSensor`) because a
 * `tm_dnd_debug` capture in the real MV3 toolbar popup showed the pointer stream
 * apparently dying after one sub-5px `pointermove` (spec C1). That evidence was
 * thin: it logged only the FIRST move and never distinguished `pointercancel`
 * from `pointerup`.
 *
 * MEASURED (scratch Chromium experiment, headless AND headed, CDP-driven mouse):
 * a press on a `draggable` element produces
 *   `pointerdown → pointermove × N → dragstart → POINTERCANCEL → dragend`
 * where N depends only on the per-event step size (N=4 at 1px/event, N=2 at
 * 2px/event, N=1 at ≥4px/event). i.e.
 *   - the threshold-crossing `pointermove` IS dispatched to JS *before*
 *     `dragstart` (Blink dispatches the move, then starts the drag), and
 *   - once the native drag starts, the pointer stream ends with a
 *     **`pointercancel`** — which is EXACTLY the "one move then silence"
 *     signature C1 read as the popup withholding events.
 *   - `preventDefault()` on `dragstart` restores the full stream (8 further
 *     moves and a normal `pointerup` in the same experiment).
 *
 * So the number of `pointermove`s delivered BEFORE `dragstart` is the one honest
 * discriminator available, and it is available on every single drag:
 *   - **≥ 2 moves** → the popup is delivering a real pointer stream → take the
 *     pointer path (`dragstart` is `preventDefault`ed, the drag is driven by
 *     pointer events, and `cursor: grabbing` is finally possible — spec C5).
 *   - **≤ 1 move** → indistinguishable from a genuinely withheld stream → take
 *     the native path, byte-for-byte as it ships today. Zero regression.
 *
 * ── Tuning the threshold ────────────────────────────────────────────────────
 * Chrome starts a native drag once the pointer passes ~3px from the press
 * origin. A real mouse accelerating from rest moves ~1–3px per event, so a human
 * drag delivers 2–4 moves under that threshold → the pointer path wins. A single
 * coarse jump (a fast flick, or a CDP `mouseMoved` of ≥4px) delivers 1 → native.
 * There is deliberately NO distance clause: a lone large move is one sample and
 * proves nothing about whether the stream CONTINUES, and the existing real-popup
 * repro helpers all open with a ≥4px step, so a distance clause would silently
 * flip the whole shipped suite onto the new path.
 *
 * Nothing here mutates the DOM or depends on React, so it is safe to read from
 * inside the `dragstart` dispatch (spec C4).
 */

import { dndDebugLog } from './dndDebug';

export type DndDragPath = 'pointer' | 'native';

/** `pointermove`s that must arrive before `dragstart` for the pointer path to win. */
export const DND_POINTER_PATH_MIN_MOVES = 2;

/** `localStorage` key / `globalThis` field that pins the path (tests + manual verification). */
export const DND_FORCE_PATH_KEY = 'tm_dnd_force_path';

interface PressState {
  target: Element | null;
  pointerId: number;
  pointerType: string;
  origin: { x: number; y: number };
  last: { x: number; y: number };
  downAt: number;
  lastMoveAt: number;
  moves: number;
  maxDist: number;
  terminator: 'pointerup' | 'pointercancel' | null;
}

export interface PressEvidence {
  /** `pointermove`s (with a non-zero delta) delivered since `pointerdown`. */
  moves: number;
  /** Largest distance from the press origin seen across those moves, px. */
  maxDist: number;
  /** ms from `pointerdown` to the read. */
  msSincePress: number;
  /** ms since the last delivered move; `-1` when none arrived. */
  msSinceLastMove: number;
  /** How the press ended, when it already has. */
  terminator: 'pointerup' | 'pointercancel' | null;
  /** A live primary mouse press whose target is on the same element chain as the drag. */
  valid: boolean;
  pointerId: number | null;
  /** Latest pointer coordinates of this press. */
  last: { x: number; y: number } | null;
}

const EMPTY: PressEvidence = {
  moves: 0,
  maxDist: 0,
  msSincePress: -1,
  msSinceLastMove: -1,
  terminator: null,
  valid: false,
  pointerId: null,
  last: null
};

let press: PressState | null = null;
let installedDoc: Document | null = null;

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Install the document-level (capture phase) press listeners. Idempotent, and
 * called once at module load of `dndHtml5Sensor` (popup boot) — deliberately NOT
 * a dnd-kit activator: registering an `onPointerDown` activator would make
 * dnd-kit instantiate a sensor (and pin its internal `activeRef`) on every plain
 * CLICK of a grip, and would block the `onDragStart` activator from ever running
 * on the native fallback path. A plain listener keeps dnd-kit's activation
 * lifecycle exactly as it is today: ONE activator, `onDragStart`.
 */
export function installDndPressTracker(doc?: Document): void {
  const d = doc ?? (typeof document !== 'undefined' ? document : null);
  if (!d || installedDoc === d) return;
  installedDoc = d;

  d.addEventListener(
    'pointerdown',
    (e) => {
      const pe = e as PointerEvent;
      // Primary mouse button only. Touch has its own sensor (and Chrome never
      // starts an HTML5 drag from touch), a secondary button never drags.
      if (pe.button !== 0) {
        press = null;
        return;
      }
      press = {
        target: pe.target instanceof Element ? pe.target : null,
        pointerId: pe.pointerId,
        pointerType: pe.pointerType,
        origin: { x: pe.clientX, y: pe.clientY },
        last: { x: pe.clientX, y: pe.clientY },
        downAt: now(),
        lastMoveAt: 0,
        moves: 0,
        maxDist: 0,
        terminator: null
      };
    },
    true
  );

  d.addEventListener(
    'pointermove',
    (e) => {
      const pe = e as PointerEvent;
      const p = press;
      if (!p || p.terminator !== null || pe.pointerId !== p.pointerId) return;
      // A `pointermove` that didn't actually move carries no evidence.
      if (pe.clientX === p.last.x && pe.clientY === p.last.y) return;
      p.last = { x: pe.clientX, y: pe.clientY };
      p.moves += 1;
      p.lastMoveAt = now();
      const dx = pe.clientX - p.origin.x;
      const dy = pe.clientY - p.origin.y;
      p.maxDist = Math.max(p.maxDist, Math.sqrt(dx * dx + dy * dy));
    },
    true
  );

  const terminate = (kind: 'pointerup' | 'pointercancel') => (e: Event) => {
    const pe = e as PointerEvent;
    const p = press;
    if (!p || pe.pointerId !== p.pointerId) return;
    p.terminator = kind;
  };
  d.addEventListener('pointerup', terminate('pointerup'), true);
  d.addEventListener('pointercancel', terminate('pointercancel'), true);
}

/**
 * Evidence for the press that produced `dragTarget`'s `dragstart`. `valid` is
 * false when there is no live primary-mouse press on the same element chain —
 * in which case the caller must fall back to the native path.
 */
export function readPressEvidence(dragTarget: EventTarget | null): PressEvidence {
  const p = press;
  if (!p) return EMPTY;
  const el = dragTarget instanceof Element ? dragTarget : null;
  const related = !!(
    p.target &&
    el &&
    (p.target === el || p.target.contains(el) || el.contains(p.target))
  );
  const t = now();
  return {
    moves: p.moves,
    maxDist: p.maxDist,
    msSincePress: Math.round(t - p.downAt),
    msSinceLastMove: p.lastMoveAt ? Math.round(t - p.lastMoveAt) : -1,
    terminator: p.terminator,
    valid: p.terminator === null && p.pointerType === 'mouse' && related,
    pointerId: p.pointerId,
    last: { ...p.last }
  };
}

/**
 * Pinned path, for the real-popup repro suite and manual verification:
 * `localStorage.tm_dnd_force_path = 'native' | 'pointer'`, or
 * `globalThis.__tmDndForcePath` (settable over CDP mid-session). Read fresh on
 * every drag on purpose — no caching — so flipping it doesn't need a reload.
 */
export function getForcedDragPath(): DndDragPath | null {
  try {
    const g = (globalThis as { __tmDndForcePath?: unknown }).__tmDndForcePath;
    if (g === 'pointer' || g === 'native') return g;
  } catch {
    /* ignore */
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(DND_FORCE_PATH_KEY);
      if (v === 'pointer' || v === 'native') return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export interface DragPathDecision {
  path: DndDragPath;
  /** The pinned value when a force flag decided it, else `null`. */
  forced: DndDragPath | null;
  evidence: PressEvidence;
}

/**
 * The per-drag path choice. See the module doc for the threshold's rationale.
 * Pure — safe to call inside the `dragstart` dispatch.
 */
export function decideDragPath(evidence: PressEvidence): DragPathDecision {
  const forced = getForcedDragPath();
  if (forced) return { path: forced, forced, evidence };
  const path: DndDragPath =
    evidence.valid && evidence.moves >= DND_POINTER_PATH_MIN_MOVES ? 'pointer' : 'native';
  return { path, forced: null, evidence };
}

/**
 * `path:pointer` / `path:native` with the numbers behind the call. This one line
 * in `__tmDndLog` (and the `tm_dnd_debug` corner chip) settles spec C1 from a
 * single real user drag: `path:native {movesSeen:0|1}` means the popup really
 * does withhold the stream; anything higher means it never did.
 */
export function logDragPathDecision(d: DragPathDecision): void {
  dndDebugLog(`path:${d.path}`, {
    movesSeen: d.evidence.moves,
    dist: Math.round(d.evidence.maxDist * 10) / 10,
    ms: d.evidence.msSincePress,
    sinceMoveMs: d.evidence.msSinceLastMove,
    pressValid: d.evidence.valid,
    forced: d.forced
  });
}

/**
 * Test hook — forget the tracked press. Deliberately does NOT un-install: the
 * listeners are registered once per document at popup boot, and re-installing
 * would double-count every move.
 */
export function resetDndPressTracker(): void {
  press = null;
}
