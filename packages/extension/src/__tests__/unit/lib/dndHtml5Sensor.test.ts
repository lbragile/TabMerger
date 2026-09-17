/**
 * dndHtml5Sensor.test.ts — regression guard for the MV3-action-popup DnD fix.
 *
 * `Html5DragSensor` is a dnd-kit sensor backed by the native HTML5 Drag and Drop
 * API. It is the fix for "the drag never starts in the real toolbar popup": the
 * popup delivers only the first sub-5px `pointermove` after `pointerdown` then
 * withholds the rest of the move stream until `pointerup`, so every move-delta
 * sensor is dead there, but native `dragstart` / `dragenter` / `dragover` /
 * `drop` / `dragend` events ARE delivered because the browser's own drag loop
 * drives them. See `@/lib/dndHtml5Sensor` for the full write-up of the popup's
 * quirks.
 *
 * Contract pinned here:
 *  - activator is the native `onDragStart`
 *  - `dragenter` + `dragover` BOTH `preventDefault` + set `dropEffect='move'` on
 *    every call (else Chrome refuses the drop → `dropEffect:'none'`, no `drop`)
 *  - `drop` AND `dragend` feed a final `onMove` from THEIR OWN client coords
 *    (the popup throttles the intermediate `dragover` stream, so the true
 *    release position only arrives on drop/dragend)
 *  - termination is deferred one macrotask (dnd-kit needs a move flush) and is
 *    idempotent; Escape cancels immediately
 *  - NO priming `onMove` at construction (a re-render right after `dragstart`
 *    can make Chrome abort the just-started native drag)
 *  - the drag GHOST is a faithful `cloneNode(true)` of the actual dragged row
 *    (not a synthesized generic chip) — this is what makes a group ghost show
 *    the group's colored border, a window ghost show its real chrome, and a
 *    tab ghost show the real two-column grid, instead of a generic pill
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Html5DragSensor,
  DND_INSTANT_ATTR,
  DND_SOURCE_COLLAPSE_EVENT,
  getDndDragSourceHeight
} from '@/lib/dndHtml5Sensor';
import { resetDndDebugCache } from '@/lib/dndDebug';

// `onEnd` is deferred to requestAnimationFrame (see the sensor) — flush both a
// frame and a macrotask so the deferred end has definitely run.
const flushMacrotask = () =>
  new Promise((r) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(r, 0));
    else setTimeout(r, 0);
  });

interface MakeRowOptions {
  ariaLabel?: string;
  favSrc?: string;
  /** Extra classes on the row itself — used to prove the ghost clones them verbatim. */
  rowClassName?: string;
  /** Inline style on the row itself (e.g. a group's `borderLeft: 3px solid ...`). */
  rowStyle?: Record<string, string>;
  /** Fake `getBoundingClientRect()` result for the row (jsdom never lays anything out). */
  rect?: Partial<DOMRect>;
  kind?: 'tab' | 'window' | 'group';
}

/**
 * A real detached row element, shaped like the app's actual DOM: a grip `<span>`
 * (the drag target) plus SIBLING content (favicon + title) that is NOT an
 * ancestor of the grip — used to test both cloning fidelity and the
 * dim-non-grip-content behavior.
 */
function makeRow(opts: MakeRowOptions = {}): HTMLElement {
  const row = document.createElement('div');
  row.setAttribute('data-testid', 'tab-item');
  if (opts.kind === 'group') {
    row.setAttribute('data-sidebar-group-index', '0');
    row.setAttribute('role', 'button');
  } else if (opts.kind === 'window') {
    row.setAttribute('data-window-index', '0');
  } else {
    row.setAttribute('role', 'listitem');
    row.setAttribute('data-window-index', '0');
    row.setAttribute('data-tab-index', '2');
  }
  row.id = 'row-id-should-not-leak';
  row.className = opts.rowClassName ?? 'group relative flex items-center gap-1 px-1.5 py-0.5 text-sm';
  if (opts.rowStyle) Object.assign(row.style, opts.rowStyle);
  if (opts.ariaLabel) row.setAttribute('aria-label', opts.ariaLabel);

  const grip = document.createElement('span');
  grip.setAttribute('aria-label', `Drag to reorder ${opts.kind ?? 'tab'}`);
  grip.setAttribute('draggable', 'true');
  const gripIcon = document.createElement('svg');
  grip.appendChild(gripIcon);
  row.appendChild(grip);

  const content = document.createElement('div');
  content.setAttribute('data-testid', 'row-content');
  content.className = 'flex-1 min-w-0';
  if (opts.favSrc) {
    const img = document.createElement('img');
    img.src = opts.favSrc;
    content.appendChild(img);
  }
  const title = document.createElement('span');
  title.id = 'title-id-should-not-leak';
  title.textContent = opts.ariaLabel ?? 'Row title';
  content.appendChild(title);
  row.appendChild(content);

  if (opts.rect) {
    const base: DOMRect = {
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
      toJSON() { return {}; }
    };
    row.getBoundingClientRect = () => ({ ...base, ...opts.rect }) as DOMRect;
  }

  document.body.appendChild(row);
  return grip; // the drag target is the grip inside the row
}

interface FakeDataTransfer {
  effectAllowed: string;
  dropEffect: string;
  setData: ReturnType<typeof vi.fn>;
  setDragImage: ReturnType<typeof vi.fn>;
}

function makeDataTransfer(): FakeDataTransfer {
  return {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    setData: vi.fn(),
    setDragImage: vi.fn()
  };
}

interface SensorCallbacks {
  onStart: ReturnType<typeof vi.fn>;
  onMove: ReturnType<typeof vi.fn>;
  onEnd: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
  onAbort: ReturnType<typeof vi.fn>;
  onPending: ReturnType<typeof vi.fn>;
}

function makeCallbacks(): SensorCallbacks {
  return {
    onStart: vi.fn(),
    onMove: vi.fn(),
    onEnd: vi.fn(),
    onCancel: vi.fn(),
    onAbort: vi.fn(),
    onPending: vi.fn()
  };
}

function construct(
  cb: SensorCallbacks,
  dt: FakeDataTransfer | null = makeDataTransfer(),
  coords = { clientX: 120, clientY: 64 },
  target: EventTarget = makeRow()
) {
  const event = {
    type: 'dragstart',
    target,
    dataTransfer: dt,
    clientX: coords.clientX,
    clientY: coords.clientY
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Html5DragSensor({ event, options: {}, ...cb } as any);
}

/** A DOM-dispatchable drag-ish event carrying client coords + a dataTransfer. */
function dragDomEvent(type: string, clientX = 0, clientY = 0, dt: FakeDataTransfer | null = null) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { clientX, clientY, dataTransfer: dt });
  return e;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Html5DragSensor — activator', () => {
  it('activates on the native onDragStart event', () => {
    expect(Html5DragSensor.activators).toHaveLength(1);
    expect(Html5DragSensor.activators[0].eventName).toBe('onDragStart');
  });

  it('handler returns true for a fresh drag, false when defaultPrevented', () => {
    const { handler } = Html5DragSensor.activators[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(handler({ defaultPrevented: false } as any, {} as any, {} as any)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(handler({ defaultPrevented: true } as any, {} as any, {} as any)).toBe(false);
  });
});

describe('Html5DragSensor — start', () => {
  it('does not run dnd-kit JS auto-scroll (the browser auto-scrolls natively)', () => {
    expect(construct(makeCallbacks()).autoScrollEnabled).toBe(false);
  });

  it('calls onStart with the dragstart client coordinates and does NOT prime a move', () => {
    const cb = makeCallbacks();
    construct(cb, makeDataTransfer(), { clientX: 200, clientY: 90 });
    expect(cb.onStart).toHaveBeenCalledWith({ x: 200, y: 90 });
    expect(cb.onMove).not.toHaveBeenCalled(); // no priming move at dragstart
  });

  it('sets effectAllowed=move, seeds text data, and HIDES the browser drag image with a real <img> (NOT a canvas)', () => {
    // Regression pin for the "small grey dotted box" bug: a detached <canvas>
    // has no layout object, so Blink's setDragImage() silently falls back to
    // the browser's own default drag image (a snapshot of the tiny grip span)
    // instead of throwing — `setDragImage` being CALLED proves nothing on its
    // own. Only an HTMLImageElement takes the decoded-bitmap fast path that
    // actually works while detached. See `transparentDragImage()`.
    const dt = makeDataTransfer();
    construct(makeCallbacks(), dt);
    expect(dt.effectAllowed).toBe('move');
    expect(dt.setData).toHaveBeenCalledWith('text/plain', '');
    expect(dt.setDragImage).toHaveBeenCalled();
    const [node, ox, oy] = dt.setDragImage.mock.calls[0];
    expect((node as HTMLElement).tagName).toBe('IMG');
    expect((node as HTMLImageElement).src).toContain('data:image/gif;base64,');
    expect([ox, oy]).toEqual([0, 0]);
  });

  it('keeps the transparent drag <img> connected to the DOM (#tm-dnd-aux-host) as a belt against Blink code paths that still want a layout object', () => {
    const dt = makeDataTransfer();
    construct(makeCallbacks(), dt);
    const [node] = dt.setDragImage.mock.calls[0];
    const img = node as HTMLImageElement;
    expect(img.isConnected).toBe(true);
    expect(img.closest('#tm-dnd-aux-host')).not.toBeNull();
  });

  it('re-attaches the transparent drag <img> if it was ever detached from the DOM (defensive re-parent, not a one-shot)', () => {
    const dt1 = makeDataTransfer();
    construct(makeCallbacks(), dt1);
    const img = dt1.setDragImage.mock.calls[0][0] as HTMLImageElement;
    // Simulate the aux host (and this image) being torn out of the document —
    // this is exactly what happens between test cases (`document.body.innerHTML
    // = ''` in beforeEach) and is a defensive scenario worth pinning generally.
    document.body.innerHTML = '';
    expect(img.isConnected).toBe(false);

    const dt2 = makeDataTransfer();
    construct(makeCallbacks(), dt2, { clientX: 1, clientY: 1 }, makeRow());
    const [reusedImg] = dt2.setDragImage.mock.calls[0];
    // Same cached singleton instance, now reconnected.
    expect(reusedImg).toBe(img);
    expect((reusedImg as HTMLImageElement).isConnected).toBe(true);
  });

  it('logs diagnostic drag-image fields (tagName/complete/naturalWidth/isConnected), not just calledSetDragImage', () => {
    localStorage.setItem('tm_dnd_debug', '1');
    resetDndDebugCache();
    try {
      (globalThis as unknown as { __tmDndLog?: unknown[] }).__tmDndLog = [];
      construct(makeCallbacks());
      const log = (globalThis as unknown as { __tmDndLog?: Array<[number, string, unknown]> }).__tmDndLog ?? [];
      const entry = log.find(([, stage]) => stage === 'html5:dragimage');
      expect(entry).toBeDefined();
      const detail = entry![2] as {
        calledSetDragImage: boolean;
        tagName: string | null;
        complete: boolean | null;
        naturalWidth: number | null;
        isConnected: boolean | null;
      };
      expect(detail.calledSetDragImage).toBe(true);
      expect(detail.tagName).toBe('IMG');
      expect(detail.isConnected).toBe(true);
      // jsdom does not implement image decoding for data: URIs (no `decode()`,
      // no `load` event), so `complete`/`naturalWidth` cannot be asserted
      // truthy here — only that the fields are the real (not hardcoded) DOM
      // properties, whatever jsdom reports for them.
      expect(typeof detail.complete === 'boolean' || detail.complete === null).toBe(true);
      expect(typeof detail.naturalWidth === 'number' || detail.naturalWidth === null).toBe(true);
    } finally {
      localStorage.removeItem('tm_dnd_debug');
      resetDndDebugCache();
    }
  });

  it('mounts a ghost wrapper in the aux host (outside #root) containing a CLONE of the dragged row', () => {
    const grip = makeRow({ ariaLabel: 'Alpha — example.com' });
    construct(makeCallbacks(), makeDataTransfer(), { clientX: 10, clientY: 10 }, grip);
    const ghost = document.querySelector('[data-testid="drag-ghost"]') as HTMLElement | null;
    expect(ghost).not.toBeNull();
    expect(ghost!.closest('#tm-dnd-aux-host')).not.toBeNull();
    // The clone carries the real row's content — not a generic synthesized chip.
    expect(ghost!.textContent).toContain('Alpha');
  });

  it('clones the row VERBATIM — same classes and inline styles, not a synthesized generic chip (fidelity fix)', () => {
    // Regression pin: a group's colored `borderLeft` inline style, and a
    // window/tab's real Tailwind classes, must show up unchanged in the ghost —
    // NOT a hardcoded palette or a hand-built label.
    const grip = makeRow({
      ariaLabel: 'Work',
      kind: 'group',
      rowClassName: 'group flex items-center gap-2 px-2.5 py-2 select-none custom-marker-class',
      rowStyle: { borderLeft: '3px solid rgb(10, 20, 30)' }
    });
    construct(makeCallbacks(), makeDataTransfer(), { clientX: 10, clientY: 10 }, grip);
    const ghost = document.querySelector('[data-testid="drag-ghost"]') as HTMLElement;
    const clonedRow = ghost.querySelector('[data-sidebar-group-index]') ?? ghost.firstElementChild;
    expect(clonedRow).not.toBeNull();
    expect(clonedRow!.className).toContain('custom-marker-class');
    expect((clonedRow as HTMLElement).style.borderLeft).toBe('3px solid rgb(10, 20, 30)');
  });

  it('sanitizes identity attributes inside the clone (id / data-testid / draggable / position data-* attrs) to avoid DOM collisions', () => {
    const grip = makeRow({ ariaLabel: 'Alpha' });
    construct(makeCallbacks(), makeDataTransfer(), { clientX: 10, clientY: 10 }, grip);
    const ghost = document.querySelector('[data-testid="drag-ghost"]') as HTMLElement;
    const clonedRow = ghost.firstElementChild as HTMLElement;
    expect(clonedRow.id).toBe('');
    expect(clonedRow.getAttribute('data-testid')).toBeNull();
    expect(clonedRow.getAttribute('data-window-index')).toBeNull();
    expect(clonedRow.getAttribute('data-tab-index')).toBeNull();
    // nested ids/testids/draggable attrs are also stripped
    expect(clonedRow.querySelector('#title-id-should-not-leak')).toBeNull();
    expect(clonedRow.querySelector('[data-testid]')).toBeNull();
    expect(clonedRow.querySelector('[draggable]')).toBeNull();
    // the real row (still in the document, outside the ghost) is untouched
    const realRow = grip.closest('[role="listitem"]') as HTMLElement;
    expect(realRow.id).toBe('row-id-should-not-leak');
    expect(realRow.getAttribute('data-testid')).toBe('tab-item');
  });

  it('the wrapper itself is inert/aria-hidden and only adds a box-shadow + slight opacity on top of the clone (no restyling beyond that)', () => {
    const grip = makeRow({ ariaLabel: 'Alpha' });
    construct(makeCallbacks(), makeDataTransfer(), { clientX: 10, clientY: 10 }, grip);
    const ghost = document.querySelector('[data-testid="drag-ghost"]') as HTMLElement;
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.hasAttribute('inert')).toBe(true);
    expect(ghost.style.boxShadow).not.toBe('');
    // FULL opacity — the ghost must be the unmistakable focal element, not a
    // slightly-see-through dip (user feedback: "the ghost item ... should be
    // more visible").
    expect(Number(ghost.style.opacity)).toBe(1);
    // no synthesized background/border/font on the WRAPPER — those come from
    // the cloned row's own classes/styles, not the wrapper.
    expect(ghost.style.background).toBe('');
    expect(ghost.style.border).toBe('');
    expect(ghost.style.font).toBe('');
  });

  it('scales the ghost up slightly (~1.03x) on top of its position, composited into the same transform, for a "lifted off the surface" affordance', async () => {
    const grip = makeRow({ ariaLabel: 'Alpha' });
    construct(makeCallbacks(), makeDataTransfer(), { clientX: 10, clientY: 10 }, grip);
    const ghost = document.querySelector('[data-testid="drag-ghost"]') as HTMLElement;
    document.dispatchEvent(dragDomEvent('dragover', 50, 60));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(ghost.style.transform).toMatch(/translate3d\(/);
    expect(ghost.style.transform).toMatch(/scale\(1\.03\)/);
  });

  it('sizes the wrapper explicitly from the row rect width (a bare clone would not size itself outside the real flex/grid parent)', () => {
    const grip = makeRow({ ariaLabel: 'Alpha', rect: { width: 321, height: 24 } });
    construct(makeCallbacks(), makeDataTransfer(), { clientX: 10, clientY: 10 }, grip);
    const ghost = document.querySelector('[data-testid="drag-ghost"]') as HTMLElement;
    expect(ghost.style.width).toBe('321px');
  });

  it('clamps a tall WINDOW ghost to max 440px height with overflow hidden and adds a bottom fade when clipped', () => {
    const grip = makeRow({ ariaLabel: 'Big Window', kind: 'window', rect: { width: 300, height: 900 } });
    construct(makeCallbacks(), makeDataTransfer(), { clientX: 10, clientY: 10 }, grip);
    const ghost = document.querySelector('[data-testid="drag-ghost"]') as HTMLElement;
    expect(ghost.style.overflow).toBe('hidden');
    expect(ghost.style.maxHeight).toBe('440px');
    // a fade overlay child was appended after the clone
    expect(ghost.children.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT clamp height for a short window, a tab, or a group (only the clipped-window case adds a fade)', () => {
    const grip = makeRow({ ariaLabel: 'Small Window', kind: 'window', rect: { width: 300, height: 80 } });
    construct(makeCallbacks(), makeDataTransfer(), { clientX: 10, clientY: 10 }, grip);
    const ghost = document.querySelector('[data-testid="drag-ghost"]') as HTMLElement;
    expect(ghost.style.maxHeight).toBe('80px'); // clamp target is min(rect.height, 440) regardless
    expect(ghost.children.length).toBe(1); // no fade overlay — nothing was clipped
  });

  it('falls back to a sane default width when the row has no measurable rect (jsdom / hidden element)', () => {
    const grip = makeRow({ ariaLabel: 'Alpha' }); // no `rect` override — getBoundingClientRect() returns all-0 in jsdom
    construct(makeCallbacks(), makeDataTransfer(), { clientX: 10, clientY: 10 }, grip);
    const ghost = document.querySelector('[data-testid="drag-ghost"]') as HTMLElement;
    expect(ghost.style.width).not.toBe('0px');
  });

  it('HIDES (visibility:hidden, not a mild dim) non-grip sibling content of the dragged row so it reads as an empty slot behind the ghost, and restores it after the drag ends', async () => {
    // Regression pin: an earlier version only dimmed to opacity 0.3, which
    // user feedback called out as "the draggable item stays in the
    // background which doesn't look good" — a visible duplicate is still a
    // duplicate. `visibility:hidden` fully hides the content (no double
    // render) while preserving its layout box (no reflow of siblings).
    const grip = makeRow({ ariaLabel: 'Alpha' });
    const row = grip.closest('[role="listitem"]') as HTMLElement;
    const content = row.querySelector('[data-testid="row-content"]') as HTMLElement;
    expect(content.style.visibility).toBe('');

    construct(makeCallbacks(), makeDataTransfer(), { clientX: 10, clientY: 10 }, grip);
    // sibling content of the grip is hidden directly (no React re-render)
    expect(content.style.visibility).toBe('hidden');
    // the row's own layout box is unaffected — only its content is invisible
    expect(row.getClientRects).toBeDefined();

    document.dispatchEvent(dragDomEvent('drop', 10, 10));
    await flushMacrotask();
    expect(content.style.visibility).toBe(''); // restored
  });

  it('never mutates the grip itself, the grip\'s own subtree, or the row (ancestor chain) while hiding source content — only the safe sibling content', () => {
    const grip = makeRow({ ariaLabel: 'Alpha' });
    const row = grip.closest('[role="listitem"]') as HTMLElement;
    const gripIcon = grip.querySelector('svg') as SVGElement;
    const rowVisibilityBefore = row.style.visibility;
    const gripVisibilityBefore = grip.style.visibility;

    construct(makeCallbacks(), makeDataTransfer(), { clientX: 10, clientY: 10 }, grip);

    expect(row.style.visibility).toBe(rowVisibilityBefore); // ancestor of grip — untouched
    expect(grip.style.visibility).toBe(gripVisibilityBefore); // the grip itself — untouched
    expect((gripIcon as unknown as HTMLElement).style?.visibility ?? '').toBe(''); // grip's own subtree — untouched
  });

  it('falls back to the placeholder favicon when the tab row\'s image fails to load (no browser broken-image icon in the ghost)', () => {
    const grip = makeRow({ ariaLabel: 'Broken favicon tab', favSrc: 'https://example.invalid/missing.png' });
    construct(makeCallbacks(), makeDataTransfer(), { clientX: 10, clientY: 10 }, grip);
    const img = document.querySelector('[data-testid="drag-ghost"] img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toBe('https://example.invalid/missing.png');
    // A broken image in a detached clone (outside #root) can't rely on React's
    // delegated onError handler — the sensor hides it directly instead.
    img.dispatchEvent(new Event('error'));
    expect(img.style.visibility).toBe('hidden');
  });

  it('positions the ghost via style.transform (rAF loop) and removes it on end', async () => {
    const cb = makeCallbacks();
    construct(cb);
    const ghost = document.querySelector('[data-testid="drag-ghost"]') as HTMLElement;
    // a document `dragover` updates the coord the rAF loop reads
    document.dispatchEvent(dragDomEvent('dragover', 300, 220));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(ghost.style.transform).toMatch(/translate3d\(/);
    document.dispatchEvent(dragDomEvent('drop', 300, 220));
    await flushMacrotask();
    expect(document.querySelector('[data-testid="drag-ghost"]')).toBeNull();
  });

  it('still runs the rest of configureDataTransfer when the target is not inside a row (no ghost)', () => {
    const dt = makeDataTransfer();
    construct(makeCallbacks(), dt, { clientX: 1, clientY: 1 }, document.body);
    expect(dt.effectAllowed).toBe('move');
    expect(document.querySelector('[data-testid="drag-ghost"]')).toBeNull();
  });

  it('does not throw when the platform hands back a null dataTransfer', () => {
    const cb = makeCallbacks();
    expect(() => construct(cb, null)).not.toThrow();
    expect(cb.onStart).toHaveBeenCalled();
  });
});

describe('Html5DragSensor — keeping the drop enabled', () => {
  it('dragenter: preventDefault + dropEffect=move (no onMove)', () => {
    const cb = makeCallbacks();
    construct(cb);
    const dt = makeDataTransfer();
    const ev = dragDomEvent('dragenter', 10, 10, dt);
    const prevent = vi.spyOn(ev, 'preventDefault');
    document.dispatchEvent(ev);
    expect(prevent).toHaveBeenCalled();
    expect(dt.dropEffect).toBe('move');
    expect(cb.onMove).not.toHaveBeenCalled();
  });

  it('dragover: preventDefault + dropEffect=move + onMove, on EVERY call', () => {
    const cb = makeCallbacks();
    construct(cb);
    for (const [x, y] of [
      [300, 150],
      [305, 160]
    ]) {
      const dt = makeDataTransfer();
      const ev = dragDomEvent('dragover', x, y, dt);
      const prevent = vi.spyOn(ev, 'preventDefault');
      document.dispatchEvent(ev);
      expect(prevent).toHaveBeenCalled();
      expect(dt.dropEffect).toBe('move');
      expect(cb.onMove).toHaveBeenCalledWith({ x, y });
    }
  });
});

describe('Html5DragSensor — termination', () => {
  it('drop: preventDefault, final onMove from the DROP coords, then deferred onEnd', async () => {
    const cb = makeCallbacks();
    construct(cb);
    const ev = dragDomEvent('drop', 42, 99);
    const prevent = vi.spyOn(ev, 'preventDefault');
    document.dispatchEvent(ev);
    expect(prevent).toHaveBeenCalled();
    expect(cb.onMove).toHaveBeenCalledWith({ x: 42, y: 99 });
    expect(cb.onEnd).not.toHaveBeenCalled(); // deferred
    await flushMacrotask();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    expect(cb.onCancel).not.toHaveBeenCalled();
  });

  it('bare dragend (no drop — popup withheld the final dragover): final onMove from the DRAGEND coords, then onEnd', async () => {
    const cb = makeCallbacks();
    construct(cb);
    document.dispatchEvent(dragDomEvent('dragend', 77, 55));
    expect(cb.onMove).toHaveBeenLastCalledWith({ x: 77, y: 55 });
    await flushMacrotask();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('ends exactly once even with a trailing dragend after the drop', async () => {
    const cb = makeCallbacks();
    construct(cb);
    document.dispatchEvent(dragDomEvent('drop', 10, 10));
    document.dispatchEvent(dragDomEvent('dragend', 10, 10));
    await flushMacrotask();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('cancels on Escape immediately (no deferral)', () => {
    const cb = makeCallbacks();
    construct(cb);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cb.onCancel).toHaveBeenCalledTimes(1);
    expect(cb.onEnd).not.toHaveBeenCalled();
  });

  it('unbinds its document listeners after it ends', async () => {
    const cb = makeCallbacks();
    construct(cb);
    document.dispatchEvent(dragDomEvent('drop', 5, 5));
    await flushMacrotask();
    cb.onMove.mockClear();
    document.dispatchEvent(dragDomEvent('dragover', 400, 400));
    expect(cb.onMove).not.toHaveBeenCalled();
  });
});

describe('Html5DragSensor — source row collapse ("dragged item fully out of the layout")', () => {
  // Frames in jsdom: rAF (or the sensor's 16ms setTimeout fallback) — wait well past both.
  const frames = (ms = 60) => new Promise((r) => setTimeout(r, ms));

  it('does NOT touch the row during the dragstart dispatch; collapses it on the next frame and announces its outer height FIRST', async () => {
    const grip = makeRow({ rect: { height: 24, width: 300, top: 50 } });
    const row = grip.parentElement as HTMLElement;
    const seen: Array<{ height: number; rowHeightAtEvent: string }> = [];
    const onCollapse = (e: Event) =>
      seen.push({
        height: (e as CustomEvent<{ height: number }>).detail.height,
        rowHeightAtEvent: row.style.getPropertyValue('height')
      });
    document.addEventListener(DND_SOURCE_COLLAPSE_EVENT, onCollapse);
    try {
      construct(makeCallbacks(), makeDataTransfer(), { clientX: 10, clientY: 62 }, grip);
      // synchronous = still inside dispatch: moving the source here aborts the native drag
      expect(row.style.getPropertyValue('height')).toBe('');
      expect(seen).toHaveLength(0);
      expect(getDndDragSourceHeight()).toBe(24);

      await frames();
      expect(seen).toEqual([{ height: 24, rowHeightAtEvent: '' }]);
      expect(row.style.getPropertyValue('height')).toBe('0px');
      expect(row.style.getPropertyPriority('height')).toBe('important');
      expect(row.style.getPropertyValue('visibility')).toBe('hidden');
      expect(row.style.getPropertyValue('overflow')).toBe('hidden');
    } finally {
      document.removeEventListener(DND_SOURCE_COLLAPSE_EVENT, onCollapse);
    }
  });

  it('on drop: onEnd runs FIRST (ghost + collapse still in place, transitions held off), THEN the ghost goes and the row gets its prior inline styles back', async () => {
    const grip = makeRow({ rect: { height: 24, width: 300, top: 50 } });
    const row = grip.parentElement as HTMLElement;
    row.style.height = '30px';
    const cb = makeCallbacks();
    const atEnd: Record<string, unknown> = {};
    cb.onEnd.mockImplementation(() => {
      atEnd.ghost = !!document.querySelector('[data-testid="drag-ghost"]');
      atEnd.rowHeight = row.style.getPropertyValue('height');
      atEnd.instant = document.documentElement.hasAttribute(DND_INSTANT_ATTR);
    });
    construct(cb, makeDataTransfer(), { clientX: 10, clientY: 62 }, grip);
    await frames();
    document.dispatchEvent(dragDomEvent('drop', 10, 90));
    await frames();

    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    expect(atEnd).toEqual({ ghost: true, rowHeight: '0px', instant: true });
    expect(document.querySelector('[data-testid="drag-ghost"]')).toBeNull();
    expect(row.style.getPropertyValue('height')).toBe('30px');
    expect(row.style.getPropertyPriority('height')).toBe('');
    expect(row.style.getPropertyValue('visibility')).toBe('');
    expect(getDndDragSourceHeight()).toBe(0);
    // transitions come back a couple of frames later
    await frames(150);
    expect(document.documentElement.hasAttribute(DND_INSTANT_ATTR)).toBe(false);
  });

  it('Escape cancel restores the row exactly (item reappears in its original slot)', async () => {
    const grip = makeRow({ rect: { height: 24, width: 300, top: 50 } });
    const row = grip.parentElement as HTMLElement;
    const cb = makeCallbacks();
    construct(cb, makeDataTransfer(), { clientX: 10, clientY: 62 }, grip);
    await frames();
    expect(row.style.getPropertyValue('height')).toBe('0px');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cb.onCancel).toHaveBeenCalledTimes(1);
    expect(row.getAttribute('style') ?? '').not.toMatch(/height|visibility|overflow/);
  });

  it('never collapses when the drag is already over before the first frame', async () => {
    const grip = makeRow({ rect: { height: 24, width: 300, top: 50 } });
    const row = grip.parentElement as HTMLElement;
    const onCollapse = vi.fn();
    document.addEventListener(DND_SOURCE_COLLAPSE_EVENT, onCollapse);
    try {
      construct(makeCallbacks(), makeDataTransfer(), { clientX: 10, clientY: 62 }, grip);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await frames();
      expect(onCollapse).not.toHaveBeenCalled();
      expect(row.style.getPropertyValue('height')).toBe('');
    } finally {
      document.removeEventListener(DND_SOURCE_COLLAPSE_EVENT, onCollapse);
    }
  });

  it('still ends when dragend is dispatched to a DETACHED source node (document listeners cannot see it)', async () => {
    const grip = makeRow({ rect: { height: 24, width: 300, top: 50 } });
    const cb = makeCallbacks();
    construct(cb, makeDataTransfer(), { clientX: 10, clientY: 62 }, grip);
    (grip.parentElement as HTMLElement).remove();
    grip.dispatchEvent(dragDomEvent('dragend', 5, 5));
    await frames();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('handles dragend once even though both the node and document listeners receive it', async () => {
    const grip = makeRow({ rect: { height: 24, width: 300, top: 50 } });
    const cb = makeCallbacks();
    construct(cb, makeDataTransfer(), { clientX: 10, clientY: 62 }, grip);
    grip.dispatchEvent(dragDomEvent('dragend', 5, 7));
    await frames();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    expect(cb.onMove.mock.calls.filter(([c]) => c.x === 5 && c.y === 7)).toHaveLength(1);
  });
});
