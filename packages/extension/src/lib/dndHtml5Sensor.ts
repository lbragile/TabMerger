import type { Activators, SensorProps } from '@dnd-kit/core';
import { flushSync } from 'react-dom';
import { dndDebugLog, dndDebugEnabled } from './dndDebug';
import { getDndAuxHost } from './dndGhostHost';
import {
  buildDragGhost,
  collapseRows,
  dragRowKind,
  measureRows,
  outerHeight,
  setDndGrabbingCursor,
  type CollapseHandle
} from './dndDragVisuals';
import { findSelectionRows, getDndDragCount } from './dndMultiDrag';
import {
  decideDragPath,
  installDndPressTracker,
  logDragPathDecision,
  readPressEvidence,
  type DndDragPath
} from './dndPressTracker';

/**
 * The popup's ONE drag sensor, with **two runtime paths chosen per press**
 * (`@/lib/dndPressTracker` owns the choice and its rationale):
 *
 *  - **pointer path** — `dragstart` is `preventDefault`ed so no native drag
 *    session ever exists, and the drag is driven by `pointermove` / `pointerup`
 *    under `setPointerCapture`. Taken when ≥2 real `pointermove`s were delivered
 *    before `dragstart`, i.e. the popup demonstrably has a live pointer stream.
 *    This is the only path on which `cursor: grabbing` is possible (spec C5), and
 *    the only one where a CDP/in-page `Escape` can cancel (spec C10).
 *  - **native path** — the **native HTML5 Drag and Drop API** (`draggable` +
 *    `dragstart` / `dragenter` / `dragover` / `drop` / `dragend`), byte-for-byte
 *    what shipped before the dual path existed. Taken whenever the evidence is
 *    absent or ambiguous, so an environment that genuinely withholds pointer
 *    moves keeps working exactly as it does today.
 *
 * Both paths share one lifecycle contract with everything downstream — session,
 * ghost, collapse, insertion gap, `scheduleEnd`/`finish`, and dnd-kit's
 * `onStart`/`onMove`/`onEnd`/`onCancel`. `useDndHandlers`'s commit path does not
 * know (or need to know) which one ran.
 *
 * ── The environment's quirks the NATIVE path is built around ────────────────
 * 1. `pointermove` is withheld → use native HTML5 drag (browser drives the loop).
 * 2. The native `dragover` stream is ALSO throttled in the popup — often to a
 *    single event near the drag origin. So the sensor must NOT depend on a
 *    steady `dragover` stream: it reads the TRUE release coordinates off the
 *    `drop` / `dragend` event itself (both extend `MouseEvent`) and does a final
 *    `onMove` with those before ending, so `unifiedCollision` resolves the real
 *    drop target even when every intermediate position was dropped.
 * 3. `drop` only fires if the drop is "allowed": EVERY `dragenter` / `dragover`
 *    must `preventDefault()` AND set `dataTransfer.dropEffect = 'move'`
 *    (compatible with `effectAllowed = 'move'` from `dragstart`). `preventDefault`
 *    alone is not enough when a custom/transparent drag image is used — Chrome
 *    shows "no-drop" and suppresses `drop`, ending with `dropEffect: 'none'`.
 * 4. MEASURED (e2e/repro/popupAbortWindow.repro.ts, real popup): the abort is NOT
 *    time-based. Moving the drag source out from under the drag origin (height 0,
 *    `display:none`, detach, a sibling overlapping it) ABORTS only when done
 *    synchronously inside the `dragstart` dispatch — including a microtask queued
 *    from it, which is where React's discrete-event commit lands. The identical
 *    mutation in `setTimeout(0)` / the first rAF / any `drag`/`dragover` SURVIVES
 *    (Blink's drag-origin hit test runs once, when dispatch returns). Attribute-
 *    only or unrelated-layout changes survive even synchronously. So: nothing that
 *    moves the source during dispatch (no priming `onMove`), and the source row is
 *    COLLAPSED in the first rAF after it (`collapseSource`).
 *    Also measured: the renderer paints nothing for ~210ms after `dragstart`.
 *
 * ── The rest ────────────────────────────────────────────────────────────────
 * There is still exactly ONE activator, `onDragStart`, on BOTH paths: the press
 * tracker is a plain document listener, not an `onPointerDown` activator, so
 * dnd-kit's activation lifecycle is untouched and a double activation is
 * structurally impossible (see `dndPressTracker`'s `installDndPressTracker` doc).
 * Activator is `onDragStart` — dnd-kit's `useSyntheticListeners` maps any
 * activator `eventName` into `listeners`, so `{...listeners}` on a handle carries
 * it; the handle also needs `draggable` (dnd-kit's `attributes` never set it).
 * `onEnd` is DEFERRED to the next animation frame (then committed inside `flushSync`,
 * see `finish`) so React flushes the final `Action.DragMove` and dnd-kit's
 * `scrollAdjustedTranslate` is populated — otherwise `createHandler(Action.DragEnd)`
 * builds a null event and the move never commits.
 *
 * Visuals (ghost, row collapse + restore) live in the sensor-agnostic
 * `dndDragVisuals` / `dndMultiDrag` helpers so a future pointer-driven sensor reuses them.
 * Escape → `onCancel()` immediately. `autoScrollEnabled = false` (the browser
 * auto-scrolls containers natively during a drag).
 *
 * Only `import type` from `@dnd-kit/core` (erased): ~15 test files mock it with
 * an incomplete factory and vitest v4 throws on undefined named exports.
 *
 * Instrumentation: `[tm-dnd] html5:<stage>` behind the `tm_dnd_debug` flag.
 */

export type Html5DragSensorOptions = Record<string, never>;

type DragSensorProps = SensorProps<Html5DragSensorOptions>;

/**
 * The sortable ROW that contains the drag grip `el`. Tab rows carry
 * `role="listitem"` + `data-window-index`; window rows `data-window-index`;
 * group rows `data-sidebar-group-index`. Deliberately does NOT match the grip
 * itself.
 */
function closestDragRow(el: Element): HTMLElement | null {
  return (el.closest('[role="listitem"]') ??
    el.closest('[data-window-index]') ??
    el.closest('[data-sidebar-group-index]')) as HTMLElement | null;
}

const raf =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number;

/**
 * Fired on `document` in the first frame after `dragstart`, immediately BEFORE the
 * source row is collapsed, with `detail.height` = the row's outer height. The DnD
 * provider opens the gap at the source slot synchronously (`flushSync`) in its
 * listener, so "row collapses" and "siblings below shift down by its height" land
 * in the same style recalc → no visible jump.
 */
export const DND_SOURCE_COLLAPSE_EVENT = 'tm-dnd:source-collapse';

/**
 * Attribute set on `<html>` for the frames where a layout change must NOT animate
 * (source collapse at drag start, the commit at drop). `globals.css` turns off row
 * `transition`s under it. Set BEFORE the React commit so any forced style recalc
 * inside the commit already sees `transition: none`.
 */
export const DND_INSTANT_ATTR = 'data-tm-dnd-instant';

/**
 * Outer height (rect + vertical margins) of the row being natively dragged, set at
 * `dragstart`, 0 when no native drag is live. The insertion index needs the size
 * of the gap to open, and dnd-kit can't provide it: its `active.rect.current.initial`
 * is the LIVE active-node rect (re-measured by a ResizeObserver), which reads 0
 * once the source row is collapsed.
 */
export interface DndDragSession {
  /** increments per native drag */
  seq: number;
  /** outer height of the source row (the size of the gap it leaves / opens) */
  height: number;
  /** source row rect at `dragstart`, viewport coords, before any collapse */
  sourceRect: { top: number; bottom: number; left: number; right: number } | null;
  /** true once `collapseSource` has taken the row out of the layout */
  collapsed: boolean;
  /** false once the source row left the document (e.g. spring-open swapped the panel) */
  sourceConnected: () => boolean;
  /**
   * Multi-drag: the OTHER visible selected rows collapsed with the source (filled in the
   * first rAF), with their pre-collapse rect + outer height and model id.
   */
  extras?: Array<{
    id: string | null;
    rect: { top: number; bottom: number; left: number; right: number };
    height: number;
    connected: () => boolean;
  }>;
}
let dragSeq = 0;
let activeSession: DndDragSession | null = null;
/** The live native drag, or null. Read by the collision layer (virtual geometry). */
export function getDndDragSession(): DndDragSession | null {
  return activeSession;
}
export function getDndDragSourceHeight(): number {
  return activeSession?.height ?? 0;
}

let instantToken = 0;
export function holdInstantFrames(): void {
  if (typeof document === 'undefined') return;
  const tok = ++instantToken;
  document.documentElement.setAttribute(DND_INSTANT_ATTR, '');
  // Frame N (now) and N+1 render with transitions off; released in N+2's rAF.
  // Changing only `transition` later never starts an animation by itself.
  raf(() =>
    raf(() => {
      if (tok === instantToken) document.documentElement.removeAttribute(DND_INSTANT_ATTR);
    })
  );
}

/**
 * 1×1 transparent GIF `HTMLImageElement` — hides the browser's own default
 * drag image on `setDragImage()` calls.
 *
 * ── Why a canvas doesn't work here (regression: the "small grey dotted box") ──
 * For any `setDragImage()` argument that is NOT an `HTMLImageElement`, Blink
 * builds the drag image by PAINTING THE ARGUMENT'S LAYOUT TREE. A detached
 * `<canvas>` has no layout object — nothing to paint — so Chrome silently
 * falls back to its own default drag image instead. `setDragImage()` does not
 * throw in this failure mode, so a debug log that only recorded
 * `calledSetDragImage: true` looked perfectly healthy while doing nothing.
 * Chrome's default drag image is a snapshot of the `draggable` element ITSELF:
 * for our grip `<span>`s (a bare `opacity-30` lucide `GripVertical`, ~12×12px)
 * that snapshot IS the "small grey dotted box" users reported — a real native
 * OS-composited drag image, invisible to `Page.captureScreenshot` (see the
 * module doc / test file for why CDP screenshots kept "passing" regardless).
 *
 * `<img>` elements are the one case Blink special-cases: it takes the DECODED
 * BITMAP directly, bypassing the layout-paint path entirely, so a detached
 * `<img>` still works for `setDragImage()` — but only once its image data has
 * actually decoded. A freshly-constructed `<img>` with `.src` just assigned is
 * NOT guaranteed decoded on the same tick a drag could start, so this
 * singleton is built ONCE at module load (popup boot, not lazily on first
 * drag) and `.decode()` is kicked off immediately, maximizing the head start
 * before any real `dragstart`. As an extra belt (not required by spec, but
 * free insurance against any Blink code path that still wants a layout
 * object), it is ALSO kept attached to `#tm-dnd-aux-host` — a permanent
 * `<body>` sibling of `#root` that is never an ancestor of any drag grip, so
 * mutating it cannot abort a native drag (see `dndGhostHost.ts`). Every call
 * re-checks `isConnected` and re-appends if something ever detached it (e.g.
 * a test wiping `document.body.innerHTML`), so this stays robust even if the
 * aux host is ever recreated.
 */
const TRANSPARENT_GIF_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

let cachedTransparentImage: HTMLImageElement | null | undefined;
function transparentDragImage(): HTMLImageElement | null {
  if (cachedTransparentImage === undefined) {
    try {
      if (typeof document === 'undefined') {
        cachedTransparentImage = null;
        return null;
      }
      const img = document.createElement('img');
      img.width = 1;
      img.height = 1;
      img.alt = '';
      img.style.cssText =
        'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
      img.src = TRANSPARENT_GIF_SRC;
      // Best-effort decode kickoff. `HTMLImageElement.decode()` isn't
      // implemented in jsdom (unit tests) — guarded so it's a silent no-op
      // there; in a real browser this resolves almost immediately for a 1×1
      // data-URI GIF. `complete`/`naturalWidth` at USE time (see the debug
      // log in `configureDataTransfer`) is the real gate, not this promise.
      img.decode?.().catch(() => {
        /* non-fatal — setDragImage still works once the image loads via the
           normal decode-on-paint path even if explicit decode() rejects */
      });
      cachedTransparentImage = img;
    } catch {
      cachedTransparentImage = null;
    }
  }
  // Re-attach on every call, not just at creation: if the aux host (or this
  // image) was ever removed from the document (observed in tests that reset
  // `document.body.innerHTML`), a detached image loses the "belt" of having a
  // layout object. Cheap no-op when already connected.
  const img = cachedTransparentImage;
  if (img && !img.isConnected) {
    const host = getDndAuxHost();
    if (host) host.appendChild(img);
  }
  return img;
}
// Force creation at module load (popup boot), not lazily on the first drag —
// gives `.decode()` the maximum possible head start before any real dragstart.
transparentDragImage();

// Start counting the pointer stream of every press from popup boot: the path
// decision at `dragstart` needs evidence gathered BEFORE it (see the module doc).
installDndPressTracker();

// The ghost is a faithful `cloneNode(true)` of the dragged row (plus a `+N` badge and a
// stacked-card look for a multi-item drag), parented in `#tm-dnd-aux-host` — a <body>
// sibling of #root, never a grip ancestor — and positioned by a direct-DOM rAF loop.
// See `buildDragGhost` in `./dndDragVisuals` for why a clone and not a synthesized card.

export class Html5DragSensor {
  /**
   * The browser auto-scrolls containers natively during an HTML5 drag, so dnd-kit's
   * JS auto-scroller stays off on the native path. Kept off on the POINTER path too
   * (where nothing auto-scrolls): the collision layer resolves against a drag-start
   * rect snapshot adjusted virtually, and a mid-drag scroll would desync it. Enabling
   * it is a separate change with its own real-popup proof — see the spec's §12.
   */
  autoScrollEnabled = false;

  private teardownFns: Array<() => void> = [];
  private finished = false;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private endRaf: number | null = null;
  private ghostEl: HTMLElement | null = null;
  private ghostRaf: number | null = null;
  /** Latest pointer coord, updated by `drag` + `dragover`; read by the rAF loop. */
  private coord = { x: 0, y: 0 };
  private ghostOffset = { x: 12, y: 10 };
  /** Elements hidden by `hideSourceContent`, with their original inline visibility to restore. */
  private hiddenEls: Array<{ el: HTMLElement; prevVisibility: string }> = [];
  /** The sortable row containing the drag grip (resolved at dragstart). */
  private sourceRow: HTMLElement | null = null;
  private seq = 0;
  private collapseRaf: number | null = null;
  /** Rows collapsed by `collapseSource` (source + other selected rows), restorable exactly. */
  private collapsed: CollapseHandle | null = null;
  /** Which of the two paths this drag took. Exposed for tests / instrumentation. */
  readonly path: DndDragPath;
  /** Pointer path only: the element holding pointer capture, released on teardown. */
  private capture: { el: Element; pointerId: number } | null = null;

  constructor(props: DragSensorProps) {
    const dragStart = props.event as DragEvent;
    const decision = decideDragPath(readPressEvidence(dragStart.target));
    this.path = decision.path;

    if (this.path === 'pointer') {
      // FIRST, and synchronously inside the `dragstart` dispatch: cancel the
      // native drag before it can begin, so exactly one drag session exists.
      // dnd-kit's activator already ran and accepted this event (it bails on
      // `defaultPrevented`), so this can't suppress our own activation — see
      // `assertSinglePath` in the unit tests.
      try {
        dragStart.preventDefault?.();
      } catch {
        /* non-fatal */
      }
    } else {
      this.configureDataTransfer(dragStart);
    }

    const start = {
      x: typeof dragStart.clientX === 'number' ? dragStart.clientX : 0,
      y: typeof dragStart.clientY === 'number' ? dragStart.clientY : 0
    };
    this.coord = { ...start };
    logDragPathDecision(decision);
    dndDebugLog(this.path === 'pointer' ? 'pointer:dragstart' : 'html5:dragstart', start);
    // Diagnostic (debug flag only): watch the dragged node for the mid-drag
    // DOM mutation that makes Chrome abort a native drag (~1 frame in, no `drop`).
    this.watchSourceMutations(dragStart.target);
    this.sourceRow = dragStart.target instanceof Element ? closestDragRow(dragStart.target) : null;
    // A layout READ during dispatch is harmless (only moving the source aborts).
    const srcRow = this.sourceRow;
    const srcRect = srcRow ? srcRow.getBoundingClientRect() : null;
    this.seq = ++dragSeq;
    activeSession = {
      seq: this.seq,
      height: srcRow ? outerHeight(srcRow) : 0,
      sourceRect: srcRect
        ? { top: srcRect.top, bottom: srcRect.bottom, left: srcRect.left, right: srcRect.right }
        : null,
      collapsed: false,
      sourceConnected: () => !!srcRow && srcRow.isConnected,
      extras: []
    };
    props.onStart(start);
    // NO priming onMove here — a re-render right after `dragstart` can make Chrome
    // abort the just-started native drag (see quirk #4). The final position comes
    // from the `drop` / `dragend` event coords instead.

    // Faithful-clone ghost card, positioned by a direct-DOM rAF loop (no React).
    this.startGhost(dragStart);

    if (this.path === 'pointer') this.attachPointerDrag(props, dragStart, start);
    else this.attachNativeDrag(props, dragStart, start);

    // Take the source row out of the layout — only AFTER dispatch (quirk #4).
    // Shared by both paths. C4 does NOT apply on the pointer path (no native
    // drag session exists to abort), so the row could collapse synchronously
    // here — deliberately not done: it buys nothing visible (one frame) and
    // would run the provider's `flushSync` collapse listener mid-`dragstart`,
    // immediately after dnd-kit's own batched `onStart` update.
    this.collapseRaf = raf(() => {
      this.collapseRaf = null;
      this.collapseSource();
    });
  }

  /**
   * NATIVE path. The browser drives the drag loop; every listener here exists to
   * work around a popup quirk documented in the module header (throttled
   * `dragover`, `drop` refused without `preventDefault` + `dropEffect`, `dragend`
   * dispatched to a possibly-unmounted source node).
   */
  private attachNativeDrag(
    props: DragSensorProps,
    dragStart: DragEvent,
    start: { x: number; y: number }
  ): void {
    // `drag` fires on the drag source ~24 Hz in the popup (measured) — the
    // cheapest continuous coord feed for the ghost. It bubbles, so a
    // document-capture listener catches it wherever the `draggable` element is.
    // `dragover` (~16 Hz) also updates `this.coord` below.
    const onDrag = (e: Event) => {
      const de = e as DragEvent;
      if (typeof de.clientX === 'number' && (de.clientX !== 0 || de.clientY !== 0)) {
        this.coord = { x: de.clientX, y: de.clientY };
      }
    };

    // dragenter + dragover: BOTH must be cancelled + dropEffect set on EVERY call
    // or Chrome refuses the drop (quirk #3). Runs in capture phase so it wins
    // regardless of what any element-level handler does.
    const allowDrop = (e: Event) => {
      const de = e as DragEvent;
      de.preventDefault();
      if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
    };
    const onDragEnter = (e: Event) => allowDrop(e);
    const onDragOver = (e: Event) => {
      allowDrop(e);
      const de = e as DragEvent;
      const x = typeof de.clientX === 'number' ? de.clientX : start.x;
      const y = typeof de.clientY === 'number' ? de.clientY : start.y;
      if (x !== 0 || y !== 0) this.coord = { x, y };
      props.onMove({ x, y });
    };
    const onDrop = (e: Event) => {
      e.preventDefault();
      const de = e as DragEvent;
      dndDebugLog('html5:drop', { x: de.clientX, y: de.clientY });
      // TRUE release coords — the drop event carries them even when every
      // intermediate `dragover` was throttled away.
      props.onMove({
        x: typeof de.clientX === 'number' ? de.clientX : start.x,
        y: typeof de.clientY === 'number' ? de.clientY : start.y
      });
      this.scheduleEnd(props);
    };
    let dragendSeen = false;
    const onDragEnd = (e: Event) => {
      // Fires via the document-capture listener AND the source-node listener below.
      if (dragendSeen) return;
      dragendSeen = true;
      const de = e as DragEvent;
      dndDebugLog('html5:dragend', { dropEffect: de.dataTransfer?.dropEffect ?? null });
      // `dragend` fires even when `drop` didn't (release outside a valid target,
      // or the popup withheld the final `dragover`). It still carries the real
      // release coords — feed them so `unifiedCollision` can resolve a target.
      props.onMove({
        x: typeof de.clientX === 'number' ? de.clientX : start.x,
        y: typeof de.clientY === 'number' ? de.clientY : start.y
      });
      this.scheduleEnd(props);
    };
    const onKeyDown = (e: Event) => {
      if ((e as KeyboardEvent).key === 'Escape') {
        dndDebugLog('html5:escape');
        this.cancel(props);
      }
    };

    const doc: Document =
      dragStart.target instanceof Node
        ? (dragStart.target.ownerDocument ?? document)
        : document;

    doc.addEventListener('drag', onDrag, true);
    doc.addEventListener('dragenter', onDragEnter, true);
    doc.addEventListener('dragover', onDragOver, true);
    doc.addEventListener('drop', onDrop, true);
    doc.addEventListener('dragend', onDragEnd, true);
    doc.addEventListener('keydown', onKeyDown, true);

    this.teardownFns.push(() => {
      doc.removeEventListener('drag', onDrag, true);
      doc.removeEventListener('dragenter', onDragEnter, true);
      doc.removeEventListener('dragover', onDragOver, true);
      doc.removeEventListener('drop', onDrop, true);
      doc.removeEventListener('dragend', onDragEnd, true);
      doc.removeEventListener('keydown', onKeyDown, true);
    });

    // `dragend` is dispatched to the drag SOURCE node. If that node has left the
    // document (spring-open swapped the panel, React unmounted the row), the
    // document-capture listener never sees it — listen on the node as well, so a
    // release outside every drop target can never leave the sensor stuck.
    const srcNode = dragStart.target;
    if (srcNode && typeof srcNode.addEventListener === 'function') {
      srcNode.addEventListener('dragend', onDragEnd);
      this.teardownFns.push(() => srcNode.removeEventListener('dragend', onDragEnd));
    }
  }

  /**
   * POINTER path. No native drag session exists (the `dragstart` was cancelled in
   * the constructor), so:
   *  - `pointermove` / `pointerup` drive the drag at the full input rate instead
   *    of the popup's throttled `dragover` (spec C2 doesn't apply here),
   *  - `cursor: grabbing` actually applies (spec C5),
   *  - `Escape` from any source cancels, including CDP-dispatched keys (spec C10),
   *  - a layout mutation can never abort anything (spec C4).
   *
   * `setPointerCapture` on the grip keeps the stream coming when the pointer
   * leaves the row or the popup's edge, and — because compatibility mouse events
   * and `:hover` follow the capture target — stops every row the pointer crosses
   * from lighting up or arming a hover tooltip mid-drag.
   */
  private attachPointerDrag(
    props: DragSensorProps,
    dragStart: DragEvent,
    start: { x: number; y: number }
  ): void {
    const doc: Document =
      dragStart.target instanceof Node ? (dragStart.target.ownerDocument ?? document) : document;
    const evidence = readPressEvidence(dragStart.target);
    const pointerId = evidence.pointerId;

    const grip = dragStart.target instanceof Element ? dragStart.target : null;
    if (grip && pointerId != null && typeof grip.setPointerCapture === 'function') {
      try {
        grip.setPointerCapture(pointerId);
        this.capture = { el: grip, pointerId };
      } catch {
        /* capture is an optimisation — the document listeners work without it */
      }
    }
    // THE POINT OF THIS PATH.
    setDndGrabbingCursor(true);

    const samePointer = (e: Event) =>
      pointerId == null || (e as PointerEvent).pointerId === undefined || (e as PointerEvent).pointerId === pointerId;
    const coordsOf = (e: Event) => {
      const pe = e as PointerEvent;
      return {
        x: typeof pe.clientX === 'number' ? pe.clientX : start.x,
        y: typeof pe.clientY === 'number' ? pe.clientY : start.y
      };
    };

    const onPointerMove = (e: Event) => {
      if (this.finished || !samePointer(e)) return;
      const c = coordsOf(e);
      this.coord = c;
      props.onMove(c);
    };
    const onPointerUp = (e: Event) => {
      if (this.finished || !samePointer(e)) return;
      const c = coordsOf(e);
      dndDebugLog('pointer:drop', c);
      props.onMove(c);
      // A `click` is synthesised on the capture target after the release; without
      // this the drop would ALSO activate the row it started on (select a tab,
      // switch the active group). A native drag never produces one.
      this.suppressNextClick(doc);
      this.scheduleEnd(props);
    };
    const onPointerCancel = (e: Event) => {
      if (this.finished || !samePointer(e)) return;
      dndDebugLog('pointer:cancel');
      this.cancel(props);
    };
    const onKeyDown = (e: Event) => {
      if ((e as KeyboardEvent).key === 'Escape') {
        dndDebugLog('pointer:escape');
        this.cancel(props);
      }
    };
    // Airtight single-path guarantee: should anything try to open a native drag
    // while this one is live (a nested `draggable`, a re-dispatch), refuse it.
    const onNativeDragStart = (e: Event) => {
      e.preventDefault();
      dndDebugLog('pointer:native-drag-suppressed');
    };

    doc.addEventListener('pointermove', onPointerMove, true);
    doc.addEventListener('pointerup', onPointerUp, true);
    doc.addEventListener('pointercancel', onPointerCancel, true);
    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('dragstart', onNativeDragStart, true);
    this.teardownFns.push(() => {
      doc.removeEventListener('pointermove', onPointerMove, true);
      doc.removeEventListener('pointerup', onPointerUp, true);
      doc.removeEventListener('pointercancel', onPointerCancel, true);
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('dragstart', onNativeDragStart, true);
    });
  }

  /**
   * Swallow the one `click` the browser synthesises from the drag's own
   * press/release (pointer path only). Self-removing, and given up after one
   * frame + 300ms so a genuine later click is never eaten.
   */
  private suppressNextClick(doc: Document): void {
    let done = false;
    const swallow = (e: Event) => {
      if (done) return;
      done = true;
      e.stopPropagation();
      e.preventDefault();
      doc.removeEventListener('click', swallow, true);
    };
    doc.addEventListener('click', swallow, true);
    setTimeout(() => {
      done = true;
      doc.removeEventListener('click', swallow, true);
    }, 300);
  }

  /** Release pointer capture and drop the grabbing cursor (pointer path only). */
  private releasePointer(): void {
    const cap = this.capture;
    this.capture = null;
    if (cap) {
      try {
        (cap.el as Element & { releasePointerCapture?: (id: number) => void }).releasePointerCapture?.(
          cap.pointerId
        );
      } catch {
        /* already released (the pointer went up) — fine */
      }
    }
    setDndGrabbingCursor(false);
  }

  /**
   * DIAGNOSTIC — only runs behind the `tm_dnd_debug` flag. Observes the DOM for
   * the ~first 1.2s of the drag and logs (`html5:mutation`) any `childList` /
   * attribute change that hits the dragged grip, its row, or an ancestor —
   * i.e. the thing that would make Chrome abort the native drag.
   */
  private watchSourceMutations(rawTarget: EventTarget | null): void {
    try {
      if (!dndDebugEnabled()) return;
      if (typeof MutationObserver === 'undefined') return;
      const el = rawTarget instanceof Element ? rawTarget : null;
      if (!el || typeof document === 'undefined') return;
      const grip = el.closest('[aria-label^="Drag to reorder"]') ?? el;
      const row =
        grip.closest('[role="listitem"]') ??
        grip.closest('[data-testid="tab-item"]') ??
        grip.closest('[data-window-index]') ??
        grip.closest('[data-sidebar-group-index]') ??
        grip.parentElement ??
        grip;
      // Ancestor chain of the drag SOURCE only (Chrome aborts a native drag when
      // the source node or one of its ancestors mutates — siblings are fine).
      const chain: Element[] = [grip];
      for (let a: Element | null = grip; a && a !== document.body; a = a.parentElement) chain.push(a);
      const onChain = (n: Node | null) => n instanceof Element && chain.includes(n);
      const tag = (t: Element) =>
        `${t.tagName?.toLowerCase()}.${(t.getAttribute?.('class') ?? '').replace(/\s+/g, '.').slice(0, 44)}`;
      const which = (t: Element) => (t === grip ? 'GRIP' : t === row ? 'ROW' : 'ANCESTOR');

      const obs = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'attributes' && onChain(r.target)) {
            const t = r.target as Element;
            dndDebugLog('html5:mutation', {
              on: which(t),
              kind: `attr:${r.attributeName}`,
              node: tag(t),
              old: r.oldValue,
              now: r.attributeName ? t.getAttribute(r.attributeName) : null
            });
          } else if (r.type === 'childList') {
            const removedHit = Array.from(r.removedNodes).some(onChain);
            const addedHit = Array.from(r.addedNodes).some(onChain);
            const targetOnChain = onChain(r.target);
            const isBodyChild = r.target === document.body || r.target === document.documentElement;
            if (removedHit || addedHit || targetOnChain || isBodyChild) {
              const snip = (n: Node) =>
                n instanceof Element
                  ? `<${n.tagName.toLowerCase()} ${(n.getAttribute('class') ?? '').slice(0, 40)}>`
                  : `#${n.nodeName}`;
              dndDebugLog('html5:mutation', {
                on: r.target instanceof Element ? which(r.target) : 'other',
                kind: 'childList',
                parent: r.target instanceof Element ? tag(r.target) : String(r.target?.nodeName),
                bodyChild: isBodyChild,
                removed: Array.from(r.removedNodes).map(snip),
                added: Array.from(r.addedNodes).map(snip),
                removedHitChain: removedHit,
                addedHitChain: addedHit,
                gripConnected: grip.isConnected
              });
            }
          }
        }
      });
      obs.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true
      });
      const stop = () => {
        obs.disconnect();
        dndDebugLog('html5:mutation-watch-end', { gripConnected: grip.isConnected });
      };
      this.teardownFns.push(stop);
      setTimeout(stop, 1200);
    } catch {
      /* diagnostic only — never break a drag */
    }
  }

  private configureDataTransfer(e: DragEvent): void {
    const dt = e.dataTransfer;
    if (!dt) return;
    try {
      dt.effectAllowed = 'move';
      // Firefox refuses to start a drag unless some data is set.
      dt.setData('text/plain', '');
    } catch {
      /* some environments lock dataTransfer — non-fatal */
    }
    try {
      // Hide the browser's own drag image — our custom ghost card is the visual.
      const img = transparentDragImage();
      const hasFn = typeof dt.setDragImage === 'function';
      if (img && hasFn) dt.setDragImage(img, 0, 0);
      // Diagnostic fields that actually matter for this failure class: an
      // `img.tagName === 'CANVAS'` or `complete: false` here (in a real
      // browser, not jsdom) is the signature of the drag-image fallback that
      // produces the "small grey dotted box" — `calledSetDragImage: true`
      // alone proved nothing (see `transparentDragImage()` doc comment).
      dndDebugLog('html5:dragimage', {
        calledSetDragImage: !!(img && hasFn),
        tagName: img?.tagName ?? null,
        complete: img?.complete ?? null,
        naturalWidth: img?.naturalWidth ?? null,
        isConnected: img?.isConnected ?? null
      });
    } catch (err) {
      dndDebugLog('html5:dragimage-error', String(err));
      /* worst case the browser's own default drag image shows */
    }
  }

  /** Build the clone-based ghost + start the direct-DOM rAF positioning loop. */
  private startGhost(dragStart: DragEvent): void {
    try {
      const target = dragStart.target;
      const host = getDndAuxHost();
      if (!(target instanceof Element) || !host) return;
      const row = this.sourceRow ?? closestDragRow(target);
      if (!row) return;
      const rect = row.getBoundingClientRect();
      // Anchor the ghost so the cursor sits where it grabbed the row (nice for
      // tabs) but never more than a small offset away.
      this.ghostOffset = {
        x: Math.min(Math.max(this.coord.x - rect.left, 8), 40),
        y: Math.min(Math.max(this.coord.y - rect.top, 6), 24)
      };
      // `getDndDragCount()` is already set: dnd-kit ran our `onDragStart` synchronously
      // inside `props.onStart` just above.
      const count = getDndDragCount();
      this.ghostEl = buildDragGhost(row, rect, { count });
      host.appendChild(this.ghostEl);
      dndDebugLog('html5:ghost', { kind: dragRowKind(row), count });

      // Secondary polish: the source row stays put and full-size underneath the
      // ghost, so the same title/content renders twice (overlapping) right at
      // the pickup point. Hide it — but ONLY elements that are NOT the grip and
      // NOT an ancestor of the grip (mutating anything on that chain aborts the
      // native drag in the MV3 popup, see the module doc / `watchSourceMutations`).
      // This is a direct DOM style write (no React, no class change), scoped to
      // the safe side-branches of the tree.
      this.hideSourceContent(row, target);

      // Subtle scale-up so the lifted ghost reads as slightly larger than the
      // real row underneath it, on top of the opacity/shadow/ring treatment
      // above — composited into the SAME transform as the position (a second
      // `transform` write per frame would just overwrite this one).
      const GHOST_SCALE = 1.03;
      const tick = () => {
        if (!this.ghostEl) return;
        this.ghostEl.style.transform = `translate3d(${Math.round(
          this.coord.x - this.ghostOffset.x
        )}px, ${Math.round(this.coord.y - this.ghostOffset.y)}px, 0) scale(${GHOST_SCALE})`;
        this.ghostRaf = raf(tick);
      };
      this.ghostRaf = raf(tick);
    } catch {
      /* ghost is cosmetic — never break a drag */
    }
  }

  /**
   * HIDE (not merely dim) every descendant of `row` EXCEPT the grip itself and
   * the chain of elements between the grip and `row` (inclusive) — i.e.
   * exactly the set `watchSourceMutations` treats as "the source" for the
   * native-drag-abort check. A mild opacity dip still read as a visible
   * duplicate sitting behind the ghost (user feedback: "the draggable item
   * stays in the background which doesn't look good"), so this now sets
   * `visibility: hidden` — the row's content fully disappears but its layout
   * box is preserved (no reflow of siblings), reading as an empty slot the
   * item was lifted out of, the standard sortable-list affordance.
   * `visibility` (not `display:none`) is used specifically because it doesn't
   * trigger a layout pass on the row's siblings/ancestors — `display` toggles
   * do. Hiding a container hides its whole subtree, so this only needs to
   * touch the top-most safe node at each level, not recurse into it. Restored
   * in `stopGhost` regardless of how the drag ends (drop, dragend, cancel).
   */
  private hideSourceContent(row: HTMLElement, rawTarget: EventTarget | null): void {
    try {
      const el = rawTarget instanceof Element ? rawTarget : null;
      if (!el) return;
      const grip = (el.closest('[aria-label^="Drag to reorder"]') ?? el) as Element;
      if (grip === row || !row.contains(grip)) return;
      // Ancestors of the grip UP TO AND INCLUDING `row`, excluding the grip
      // itself — these get walked (recursed into) but never hidden directly.
      // The grip and everything inside it is treated as an untouchable leaf.
      const chain = new Set<Element>();
      for (let a: Element | null = grip.parentElement; a; a = a.parentElement) {
        chain.add(a);
        if (a === row) break;
      }
      const walk = (container: Element) => {
        for (const child of Array.from(container.children)) {
          if (child === grip) continue; // never touch the grip or its subtree
          if (chain.has(child)) {
            walk(child); // stay on the safe path toward the grip
          } else if (child instanceof HTMLElement) {
            this.hiddenEls.push({ el: child, prevVisibility: child.style.visibility });
            child.style.visibility = 'hidden';
          }
        }
      };
      walk(row);
    } catch {
      /* cosmetic only — never break a drag */
    }
  }

  private unhideSourceContent(): void {
    for (const { el, prevVisibility } of this.hiddenEls) {
      try {
        el.style.visibility = prevVisibility;
      } catch {
        /* ignore */
      }
    }
    this.hiddenEls = [];
  }

  /**
   * Take the source row out of the layout: inline `!important` zero height /
   * padding / margin / vertical borders + `overflow:hidden` + `visibility:hidden`,
   * prior inline values kept for {@link restoreCollapse}. Zero HEIGHT rather than
   * `display:none` on purpose: dnd-kit re-measures the active node through a
   * ResizeObserver, and a `display:none` node measures as a 0×0 rect at (0,0),
   * which would drag every rect-based collision fallback to the top-left corner;
   * a 0-height row keeps its top/left/width.
   *
   * Runs in the first rAF after `dragstart`, never during dispatch (quirk #4).
   * Announces the row's OUTER height first ({@link DND_SOURCE_COLLAPSE_EVENT}) so
   * the provider opens the gap at the source slot in this same task.
   */
  private collapseSource(): void {
    if (this.finished || this.collapsed) return;
    const row = this.sourceRow;
    if (!row || !row.isConnected) return;
    try {
      // Measure EVERY row before collapsing any (a collapse shifts the rows below it).
      // Multi-drag: the other visible selected rows leave the layout with the source.
      const [source, ...extras] = measureRows([row, ...findSelectionRows(row.ownerDocument ?? document, row)]);
      if (!source) return;
      const height = source.height;
      if (activeSession?.seq === this.seq) activeSession.height = height;
      holdInstantFrames();
      try {
        document.dispatchEvent(new CustomEvent(DND_SOURCE_COLLAPSE_EVENT, { detail: { height } }));
      } catch {
        /* a listener threw — still collapse; the gap is cosmetic */
      }
      this.collapsed = collapseRows([source, ...extras]);
      if (activeSession?.seq === this.seq) {
        activeSession.extras = extras.map((m) => ({
          id: m.id,
          rect: m.rect,
          height: m.height,
          connected: () => m.row.isConnected
        }));
        activeSession.collapsed = true;
      }
      dndDebugLog('html5:collapse', { height: Math.round(height), extra: extras.length });
    } catch {
      /* cosmetic — never break a drag */
    }
  }

  private restoreCollapse(): void {
    const c = this.collapsed;
    this.collapsed = null;
    c?.restore();
  }

  private stopGhost(): void {
    if (this.ghostRaf != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.ghostRaf);
    }
    this.ghostRaf = null;
    if (this.ghostEl) {
      this.ghostEl.remove();
      this.ghostEl = null;
    }
    this.unhideSourceContent();
  }

  /** Visual cleanup: ghost, hidden source content, collapsed row. */
  private restoreVisuals(): void {
    this.stopGhost();
    this.restoreCollapse();
  }

  /** Non-visual cleanup: pointer capture + cursor, pending frames/timers, every listener. */
  private detach(): void {
    // Before the commit flush, not after: the pointer must stop reading
    // `grabbing` the instant the drop lands.
    this.releasePointer();
    if (this.collapseRaf != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.collapseRaf);
    }
    this.collapseRaf = null;
    if (this.endTimer != null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    if (this.endRaf != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.endRaf);
      this.endRaf = null;
    }
    for (const fn of this.teardownFns) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    this.teardownFns = [];
  }

  /**
   * Defer `onEnd` until just BEFORE the next paint (`requestAnimationFrame`).
   *
   * Two reasons:
   *  - React must flush the final `Action.DragMove` (from the drop/dragend coords)
   *    so dnd-kit's `scrollAdjustedTranslate` + `over` are current — otherwise
   *    `createHandler(Action.DragEnd)` skips the `onDragEnd` lifecycle prop and
   *    the move never commits. rAF runs after React's post-event flush.
   *  - rAF fires before the browser paints, so our `onDragEnd` → `setQueryData`
   *    (final order) + `reset()` (clear drag state) land in the SAME paint as the
   *    drop. `setTimeout(0)` can let the browser paint the "old order, drag still
   *    active" frame first → the post-drop flicker.
   * `setTimeout` fallback for environments without rAF (some test runners).
   */
  private scheduleEnd(props: DragSensorProps): void {
    if (this.finished || this.endTimer != null || this.endRaf != null) return;
    const run = () => {
      this.endRaf = null;
      this.endTimer = null;
      this.end(props);
    };
    if (typeof requestAnimationFrame === 'function') {
      this.endRaf = requestAnimationFrame(run);
    } else {
      this.endTimer = setTimeout(run, 0);
    }
  }

  private end(props: DragSensorProps): void {
    this.finish(() => props.onEnd());
  }

  private cancel(props: DragSensorProps): void {
    this.finish(() => props.onCancel());
  }

  /**
   * Drop / cancel. Everything below runs in ONE task, so it lands in ONE paint:
   *  1. row transitions off for this frame ({@link holdInstantFrames})
   *  2. notify dnd-kit inside `flushSync` → its DragEnd/Cancel state reset AND our
   *     `onDragEnd` (new order via a synchronously-notified `setQueryData`, drag
   *     state cleared) commit to the DOM now — not in a later macrotask after the
   *     browser has painted the old order
   *  3. only then remove the ghost and un-hide / un-collapse the source row
   * Measured before this ordering (real popup, frame sampler): tearing the visuals
   * down BEFORE `onEnd` painted the source back in its OLD slot for one frame, the
   * new order arrived a frame later, and siblings then slid for ~200ms.
   */
  private finish(notify: () => void): void {
    if (this.finished) return;
    this.finished = true;
    if (activeSession?.seq === this.seq) activeSession = null;
    this.detach();
    holdInstantFrames();
    try {
      flushSync(notify);
    } finally {
      this.restoreVisuals();
    }
  }

  static activators: Activators<Html5DragSensorOptions> = [
    {
      eventName: 'onDragStart',
      handler: (event: { defaultPrevented?: boolean }) => {
        // A nested native draggable (or anything upstream) already claimed it.
        if (event?.defaultPrevented) return false;
        return true;
      }
    }
  ];
}
