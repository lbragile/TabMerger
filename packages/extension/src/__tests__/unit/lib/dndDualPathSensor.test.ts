/**
 * dndDualPathSensor.test.ts — the per-press runtime choice between the POINTER and
 * NATIVE drag paths (`@/lib/dndPressTracker` + `Html5DragSensor`).
 *
 * The popup shipped a native HTML5 drag because a real-popup capture suggested the
 * pointer stream dies after one move (spec C1). A scratch Chromium experiment showed
 * that "one move then silence" is ALSO the ordinary signature of a native drag taking
 * over (`pointerdown → pointermove×N → dragstart → pointercancel`), so the sensor now
 * decides per press from the one honest signal available: how many `pointermove`s were
 * delivered BEFORE `dragstart`.
 *
 * Contract pinned here:
 *  - ≥2 pre-`dragstart` moves → pointer path; ≤1 → native path; no live/mouse press → native
 *  - a force flag (`localStorage.tm_dnd_force_path` / `globalThis.__tmDndForcePath`) pins either
 *  - the pointer path `preventDefault`s the `dragstart` (no native session) and never
 *    touches `dataTransfer`; the native path does the opposite. Never both.
 *  - `onStart` fires exactly once per drag on either path — there is still only ONE
 *    dnd-kit activator, so a double activation is structurally impossible
 *  - `cursor: grabbing` (the `data-tm-dnd-grabbing` attribute) is applied on the pointer
 *    path only, and removed on drop, cancel and Escape
 *  - the pointer path drives `onMove` from `pointermove` and ends on `pointerup`, and
 *    swallows the click the release would otherwise synthesise
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Html5DragSensor } from '@/lib/dndHtml5Sensor';
import { DND_GRABBING_ATTR } from '@/lib/dndDragVisuals';
import {
  DND_FORCE_PATH_KEY,
  DND_POINTER_PATH_MIN_MOVES,
  decideDragPath,
  getForcedDragPath,
  readPressEvidence,
  resetDndPressTracker
} from '@/lib/dndPressTracker';

/** `onEnd` is deferred to rAF — flush a frame and a macrotask. */
const flushEnd = () =>
  new Promise((r) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(r, 0));
    else setTimeout(r, 0);
  });

/** jsdom has no `PointerEvent`; a `MouseEvent` with the pointer fields bolted on is enough. */
function firePointer(
  target: EventTarget,
  type: string,
  opts: { x?: number; y?: number; pointerId?: number; pointerType?: string; button?: number } = {}
): Event {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.x ?? 0,
    clientY: opts.y ?? 0,
    button: opts.button ?? 0
  });
  Object.defineProperty(e, 'pointerId', { value: opts.pointerId ?? 1 });
  Object.defineProperty(e, 'pointerType', { value: opts.pointerType ?? 'mouse' });
  target.dispatchEvent(e);
  return e;
}

function makeRow() {
  const row = document.createElement('div');
  row.setAttribute('role', 'listitem');
  row.setAttribute('data-window-index', '0');
  row.setAttribute('data-tab-index', '1');
  row.className = 'flex items-center';

  const grip = document.createElement('span') as HTMLSpanElement & {
    setPointerCapture?: (id: number) => void;
    releasePointerCapture?: (id: number) => void;
  };
  grip.setAttribute('aria-label', 'Drag to reorder tab');
  grip.setAttribute('draggable', 'true');
  grip.appendChild(document.createElement('i'));
  row.appendChild(grip);

  const content = document.createElement('div');
  content.textContent = 'A tab';
  row.appendChild(content);

  document.body.appendChild(row);
  return { row, grip };
}

function makeDataTransfer() {
  return {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    setData: vi.fn(),
    setDragImage: vi.fn()
  };
}

function makeCallbacks() {
  return {
    onStart: vi.fn(),
    onMove: vi.fn(),
    onEnd: vi.fn(),
    onCancel: vi.fn(),
    onAbort: vi.fn(),
    onPending: vi.fn()
  };
}

/**
 * The real sequence: a press, `moves` pointer moves of 2px each, then a genuinely
 * dispatched `dragstart` on the grip. The sensor is constructed from that real event,
 * so `preventDefault()` / `defaultPrevented` are the browser's, not a stub's.
 */
function pressAndDrag(
  moves: number,
  opts: { pointerType?: string; dt?: ReturnType<typeof makeDataTransfer> | null } = {}
) {
  const { row, grip } = makeRow();
  const cb = makeCallbacks();
  const pointerType = opts.pointerType ?? 'mouse';
  firePointer(grip, 'pointerdown', { x: 100, y: 50, pointerType });
  for (let i = 1; i <= moves; i++) {
    firePointer(grip, 'pointermove', { x: 100, y: 50 + i * 2, pointerType });
  }
  const dt = opts.dt === undefined ? makeDataTransfer() : opts.dt;
  const dragStart = new MouseEvent('dragstart', {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 50 + moves * 2
  });
  Object.assign(dragStart, { dataTransfer: dt });
  // dnd-kit's activator runs (and accepts) BEFORE the sensor is constructed.
  const accepted = Html5DragSensor.activators[0].handler(
    dragStart as never,
    {} as never,
    {} as never
  );
  grip.dispatchEvent(dragStart);
  const sensor = new Html5DragSensor({
    event: dragStart,
    options: {},
    ...cb
  } as never);
  return { sensor, cb, grip, row, dt, dragStart, accepted };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(DND_GRABBING_ATTR);
  resetDndPressTracker();
  try {
    localStorage.removeItem(DND_FORCE_PATH_KEY);
  } catch {
    /* ignore */
  }
  delete (globalThis as { __tmDndForcePath?: unknown }).__tmDndForcePath;
});

afterEach(() => {
  // End any drag a test left live: both paths cancel on Escape, and `finish()` is
  // what removes their document-level listeners. Without this, a leftover pointer
  // drag's native-drag suppressor would cancel the NEXT test's `dragstart`.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.documentElement.removeAttribute(DND_GRABBING_ATTR);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('press evidence + activation threshold', () => {
  it('counts only moves that actually moved, and measures distance from the origin', () => {
    const { grip } = makeRow();
    firePointer(grip, 'pointerdown', { x: 10, y: 10 });
    firePointer(grip, 'pointermove', { x: 10, y: 10 }); // no delta → not evidence
    firePointer(grip, 'pointermove', { x: 13, y: 14 });
    const ev = readPressEvidence(grip);
    expect(ev.moves).toBe(1);
    expect(Math.round(ev.maxDist)).toBe(5);
    expect(ev.valid).toBe(true);
  });

  it(`takes the pointer path at ${DND_POINTER_PATH_MIN_MOVES} moves and the native path below it`, () => {
    const { grip } = makeRow();
    firePointer(grip, 'pointerdown', { x: 10, y: 10 });
    expect(decideDragPath(readPressEvidence(grip)).path).toBe('native');
    firePointer(grip, 'pointermove', { x: 10, y: 12 });
    expect(decideDragPath(readPressEvidence(grip)).path).toBe('native');
    firePointer(grip, 'pointermove', { x: 10, y: 14 });
    expect(decideDragPath(readPressEvidence(grip)).path).toBe('pointer');
    firePointer(grip, 'pointermove', { x: 10, y: 16 });
    expect(decideDragPath(readPressEvidence(grip)).path).toBe('pointer');
  });

  it('falls back to native for touch, for an unrelated press, and once the press ended', () => {
    const { grip } = makeRow();
    const other = document.createElement('button');
    document.body.appendChild(other);

    firePointer(grip, 'pointerdown', { x: 10, y: 10, pointerType: 'touch' });
    firePointer(grip, 'pointermove', { x: 10, y: 12, pointerType: 'touch' });
    firePointer(grip, 'pointermove', { x: 10, y: 14, pointerType: 'touch' });
    expect(decideDragPath(readPressEvidence(grip)).path).toBe('native');

    resetDndPressTracker();
    firePointer(other, 'pointerdown', { x: 10, y: 10 });
    firePointer(other, 'pointermove', { x: 10, y: 12 });
    firePointer(other, 'pointermove', { x: 10, y: 14 });
    expect(decideDragPath(readPressEvidence(grip)).evidence.valid).toBe(false);
    expect(decideDragPath(readPressEvidence(grip)).path).toBe('native');

    resetDndPressTracker();
    firePointer(grip, 'pointerdown', { x: 10, y: 10 });
    firePointer(grip, 'pointermove', { x: 10, y: 12 });
    firePointer(grip, 'pointermove', { x: 10, y: 14 });
    firePointer(grip, 'pointerup', { x: 10, y: 14 });
    expect(readPressEvidence(grip).terminator).toBe('pointerup');
    expect(decideDragPath(readPressEvidence(grip)).path).toBe('native');
  });

  it('records a native drag takeover as pointercancel, not pointerup (the C1 evidence gap)', () => {
    const { grip } = makeRow();
    firePointer(grip, 'pointerdown', { x: 10, y: 10 });
    firePointer(grip, 'pointermove', { x: 10, y: 14 });
    firePointer(grip, 'pointercancel', { x: 10, y: 14 });
    expect(readPressEvidence(grip).terminator).toBe('pointercancel');
  });

  it('a secondary mouse button never counts as a drag press', () => {
    const { grip } = makeRow();
    firePointer(grip, 'pointerdown', { x: 10, y: 10, button: 2 });
    firePointer(grip, 'pointermove', { x: 10, y: 12 });
    firePointer(grip, 'pointermove', { x: 10, y: 14 });
    expect(decideDragPath(readPressEvidence(grip)).path).toBe('native');
  });

  it('a force flag pins either path regardless of the evidence', () => {
    const { grip } = makeRow();
    firePointer(grip, 'pointerdown', { x: 10, y: 10 });
    localStorage.setItem(DND_FORCE_PATH_KEY, 'pointer');
    expect(getForcedDragPath()).toBe('pointer');
    expect(decideDragPath(readPressEvidence(grip))).toMatchObject({ path: 'pointer', forced: 'pointer' });

    localStorage.setItem(DND_FORCE_PATH_KEY, 'native');
    firePointer(grip, 'pointermove', { x: 10, y: 12 });
    firePointer(grip, 'pointermove', { x: 10, y: 14 });
    expect(decideDragPath(readPressEvidence(grip))).toMatchObject({ path: 'native', forced: 'native' });

    localStorage.setItem(DND_FORCE_PATH_KEY, 'nonsense');
    expect(getForcedDragPath()).toBeNull();
    (globalThis as { __tmDndForcePath?: unknown }).__tmDndForcePath = 'pointer';
    expect(getForcedDragPath()).toBe('pointer');
  });
});

describe('native drag suppression — exactly one drag runs', () => {
  it('pointer path cancels the dragstart and never configures dataTransfer', () => {
    const { sensor, dragStart, dt, accepted } = pressAndDrag(3);
    expect(accepted).toBe(true); // dnd-kit accepted BEFORE we prevented anything
    expect(sensor.path).toBe('pointer');
    expect(dragStart.defaultPrevented).toBe(true);
    expect(dt?.effectAllowed).toBe('uninitialized');
    expect(dt?.setData).not.toHaveBeenCalled();
    expect(dt?.setDragImage).not.toHaveBeenCalled();
  });

  it('native path leaves the dragstart alone and configures dataTransfer as before', () => {
    const { sensor, dragStart, dt } = pressAndDrag(1);
    expect(sensor.path).toBe('native');
    expect(dragStart.defaultPrevented).toBe(false);
    expect(dt?.effectAllowed).toBe('move');
    expect(dt?.setData).toHaveBeenCalled();
    expect(dt?.setDragImage).toHaveBeenCalled();
  });

  it('onStart fires exactly once, and a second dragstart during a pointer drag is refused', () => {
    const { cb, grip } = pressAndDrag(3);
    expect(cb.onStart).toHaveBeenCalledTimes(1);

    const second = new MouseEvent('dragstart', { bubbles: true, cancelable: true });
    grip.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
    expect(cb.onStart).toHaveBeenCalledTimes(1);
  });

  it('has a single dnd-kit activator, so two sensors can never be instantiated for one press', () => {
    expect(Html5DragSensor.activators).toHaveLength(1);
    expect(Html5DragSensor.activators[0].eventName).toBe('onDragStart');
    // …and that one activator refuses an already-cancelled dragstart.
    expect(
      Html5DragSensor.activators[0].handler({ defaultPrevented: true } as never, {} as never, {} as never)
    ).toBe(false);
  });
});

describe('grabbing cursor', () => {
  const grabbing = () => document.documentElement.hasAttribute(DND_GRABBING_ATTR);

  it('is applied for the whole pointer drag and removed on drop', async () => {
    const { cb, grip } = pressAndDrag(3);
    expect(grabbing()).toBe(true);
    firePointer(grip, 'pointermove', { x: 140, y: 90 });
    expect(grabbing()).toBe(true);
    firePointer(grip, 'pointerup', { x: 140, y: 90 });
    await flushEnd();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    expect(grabbing()).toBe(false);
  });

  it('is removed when the drag is cancelled by pointercancel', async () => {
    const { cb, grip } = pressAndDrag(3);
    expect(grabbing()).toBe(true);
    firePointer(grip, 'pointercancel', { x: 140, y: 90 });
    await flushEnd();
    expect(cb.onCancel).toHaveBeenCalledTimes(1);
    expect(grabbing()).toBe(false);
  });

  it('is removed when the drag is cancelled by Escape', async () => {
    const { cb } = pressAndDrag(3);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushEnd();
    expect(cb.onCancel).toHaveBeenCalledTimes(1);
    expect(grabbing()).toBe(false);
  });

  it('is never applied on the native path (spec C5 — the OS owns that cursor)', async () => {
    const { grip } = pressAndDrag(1);
    expect(grabbing()).toBe(false);
    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    grip.dispatchEvent(drop);
    await flushEnd();
    expect(grabbing()).toBe(false);
  });
});

describe('pointer path lifecycle', () => {
  it('drives onMove from pointermove and ends from the pointerup coordinates', async () => {
    const { cb, grip } = pressAndDrag(3);
    expect(cb.onMove).not.toHaveBeenCalled(); // no priming move
    firePointer(grip, 'pointermove', { x: 130, y: 70 });
    firePointer(grip, 'pointermove', { x: 160, y: 120 });
    expect(cb.onMove).toHaveBeenNthCalledWith(1, { x: 130, y: 70 });
    expect(cb.onMove).toHaveBeenNthCalledWith(2, { x: 160, y: 120 });
    firePointer(grip, 'pointerup', { x: 200, y: 300 });
    expect(cb.onMove).toHaveBeenLastCalledWith({ x: 200, y: 300 });
    await flushEnd();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    expect(cb.onCancel).not.toHaveBeenCalled();
  });

  it('takes pointer capture on the grip and releases it when the drag ends', async () => {
    const { row } = makeRow();
    const grip = row.querySelector('span') as HTMLSpanElement & {
      setPointerCapture: (id: number) => void;
      releasePointerCapture: (id: number) => void;
    };
    grip.setPointerCapture = vi.fn();
    grip.releasePointerCapture = vi.fn();
    firePointer(grip, 'pointerdown', { x: 10, y: 10, pointerId: 7 });
    firePointer(grip, 'pointermove', { x: 10, y: 12, pointerId: 7 });
    firePointer(grip, 'pointermove', { x: 10, y: 14, pointerId: 7 });
    const cb = makeCallbacks();
    const dragStart = new MouseEvent('dragstart', { bubbles: true, cancelable: true });
    Object.assign(dragStart, { dataTransfer: makeDataTransfer() });
    grip.dispatchEvent(dragStart);
    new Html5DragSensor({ event: dragStart, options: {}, ...cb } as never);

    expect(grip.setPointerCapture).toHaveBeenCalledWith(7);
    firePointer(grip, 'pointerup', { x: 10, y: 40, pointerId: 7 });
    await flushEnd();
    expect(grip.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('ignores a different pointer id mid-drag', async () => {
    const { cb, grip } = pressAndDrag(3);
    firePointer(grip, 'pointermove', { x: 500, y: 500, pointerId: 99 });
    expect(cb.onMove).not.toHaveBeenCalled();
    firePointer(grip, 'pointerup', { x: 500, y: 500, pointerId: 99 });
    await flushEnd();
    expect(cb.onEnd).not.toHaveBeenCalled();
  });

  it('swallows the click the release synthesises, so the drop does not also activate the row', async () => {
    const { grip, row } = pressAndDrag(3);
    const rowClick = vi.fn();
    row.addEventListener('click', rowClick);
    firePointer(grip, 'pointerup', { x: 140, y: 90 });
    await flushEnd();
    grip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(rowClick).not.toHaveBeenCalled();
    // …only the ONE click, never a later genuine one.
    grip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(rowClick).toHaveBeenCalledTimes(1);
  });

  it('does not run dnd-kit JS auto-scroll on either path', () => {
    expect(pressAndDrag(3).sensor.autoScrollEnabled).toBe(false);
    resetDndPressTracker();
    expect(pressAndDrag(1).sensor.autoScrollEnabled).toBe(false);
  });
});
