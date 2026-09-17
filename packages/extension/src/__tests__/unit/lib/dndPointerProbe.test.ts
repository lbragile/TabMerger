/**
 * dndPointerProbe.test.ts — the DIAGNOSTIC pointer-stream probe must be completely
 * inert unless `localStorage.tm_dnd_pointer_probe === '1'` (no listeners, no
 * output, grips stay draggable, the HTML5 sensor stays registered), and when it
 * IS set it must report exactly one `[tm-dnd-probe] {...}` line per grip press.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DND_POINTER_PROBE_ACTIVE,
  DND_POINTER_PROBE_FLAG,
  DND_POINTER_PROBE_LOG_KEY,
  installDndPointerProbe as installProbe,
  readDndPointerProbeFlag
} from '@/lib/dndPointerProbe';

const PREFIX = '[tm-dnd-probe] ';

function makeGrip() {
  const row = document.createElement('div');
  const grip = document.createElement('span') as HTMLSpanElement & {
    setPointerCapture?: (id: number) => void;
    hasPointerCapture?: (id: number) => boolean;
  };
  grip.setAttribute('aria-label', 'Drag to reorder tab');
  const icon = document.createElement('i');
  grip.appendChild(icon);
  row.appendChild(grip);
  const other = document.createElement('button');
  row.appendChild(other);
  document.body.appendChild(row);
  return { grip, icon, other };
}

function fire(
  target: EventTarget,
  type: string,
  init: MouseEventInit & { pointerId?: number; coalesced?: number } = {}
): Event {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  if (init.pointerId !== undefined) Object.defineProperty(e, 'pointerId', { value: init.pointerId });
  if (init.coalesced !== undefined) {
    const n = init.coalesced;
    Object.defineProperty(e, 'getCoalescedEvents', { value: () => new Array(n).fill(null) });
  }
  target.dispatchEvent(e);
  return e;
}

function parseLine(call: unknown[]): Record<string, unknown> {
  const line = call[0] as string;
  expect(line.startsWith(PREFIX)).toBe(true);
  return JSON.parse(line.slice(PREFIX.length));
}

// Every install registers a document listener that outlives the test unless
// disposed — track them so presses in one test can't be recorded by another's probe.
const disposers: Array<() => void> = [];
function installDndPointerProbe(...args: Parameters<typeof installProbe>) {
  const dispose = installProbe(...args);
  disposers.push(dispose);
  return dispose;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  disposers.splice(0).forEach((d) => d());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('dndPointerProbe — INERT when the flag is unset', () => {
  it('the flag reads as off, and only the exact value "1" turns it on', () => {
    expect(readDndPointerProbeFlag()).toBe(false);
    localStorage.setItem(DND_POINTER_PROBE_FLAG, 'true');
    expect(readDndPointerProbeFlag()).toBe(false);
    localStorage.setItem(DND_POINTER_PROBE_FLAG, '1');
    expect(readDndPointerProbeFlag()).toBe(true);
  });

  it('DND_POINTER_PROBE_ACTIVE is false for a popup loaded without the flag (grips keep `draggable`, HTML5 sensor kept)', () => {
    expect(DND_POINTER_PROBE_ACTIVE).toBe(false);
  });

  it('installDndPointerProbe adds NO listener to document or window and returns a harmless disposer', () => {
    const docSpy = vi.spyOn(document, 'addEventListener');
    const winSpy = vi.spyOn(window, 'addEventListener');
    const dispose = installDndPointerProbe();
    expect(docSpy).not.toHaveBeenCalled();
    expect(winSpy).not.toHaveBeenCalled();
    expect(() => dispose()).not.toThrow();
  });

  it('a full grip press produces no console line, no chip, no stored log, and prevents nothing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    installDndPointerProbe();
    const { grip } = makeGrip();
    fire(grip, 'pointerdown', { clientX: 1, clientY: 1, pointerId: 1 });
    fire(document, 'pointermove', { clientX: 40, clientY: 40 });
    const sel = fire(document, 'selectstart');
    fire(document, 'pointerup', { clientX: 40, clientY: 40 });
    await new Promise((r) => setTimeout(r, 150));
    expect(log).not.toHaveBeenCalled();
    expect(document.getElementById('tm-dnd-debug-chip')).toBeNull();
    expect(localStorage.getItem(DND_POINTER_PROBE_LOG_KEY)).toBeNull();
    expect(sel.defaultPrevented).toBe(false);
  });
});

describe('dndPointerProbe — enabled', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem(DND_POINTER_PROBE_FLAG, '1');
  });

  it('records per-type move counts on document AND window, coalesced totals, max distance and the release lifecycle — then ONE line to console, chip and log', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const dispose = installDndPointerProbe();
    const { icon } = makeGrip();

    fire(icon, 'pointerdown', { clientX: 10, clientY: 10, pointerId: 7 });
    fire(document, 'pointermove', { clientX: 10, clientY: 30, coalesced: 3 });
    fire(document, 'pointermove', { clientX: 10, clientY: 40, coalesced: 3 });
    fire(document, 'pointerrawupdate', { clientX: 10, clientY: 40, coalesced: 2 });
    fire(document, 'mousemove', { clientX: 40, clientY: 50 });
    fire(document, 'pointerup', { clientX: 40, clientY: 50 });
    fire(document, 'mouseup', { clientX: 40, clientY: 50 });
    expect(log).not.toHaveBeenCalled(); // waits for trailing lifecycle events
    vi.advanceTimersByTime(200);

    expect(log).toHaveBeenCalledTimes(1);
    const s = parseLine(log.mock.calls[0]);
    expect(s).toMatchObject({
      press: 1,
      mode: 'no-capture',
      captureSet: null,
      grip: 'Drag to reorder tab',
      endedBy: 'pointerup',
      coalescedPointermove: 6,
      coalescedRawupdate: 2,
      maxDistPx: 50
    });
    expect(s.pointermove).toMatchObject({ doc: 2, win: 2 });
    expect(s.pointerrawupdate).toMatchObject({ doc: 1, win: 1 });
    expect(s.mousemove).toMatchObject({ doc: 1, win: 1 });
    expect((s.lifecycle as Array<[string, number]>).map(([type]) => type)).toEqual(['pointerup', 'mouseup']);

    const line = log.mock.calls[0][0] as string;
    expect(document.getElementById('tm-dnd-debug-chip')?.textContent).toContain(line);
    expect(JSON.parse(localStorage.getItem(DND_POINTER_PROBE_LOG_KEY) ?? '[]')).toEqual([line]);
    dispose();
  });

  it('alternates per press: odd = no capture, even = setPointerCapture on the pressed grip', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    installDndPointerProbe();
    const { grip } = makeGrip();
    grip.setPointerCapture = vi.fn();
    grip.hasPointerCapture = vi.fn(() => true);

    for (let i = 0; i < 2; i++) {
      fire(grip, 'pointerdown', { clientX: 0, clientY: 0, pointerId: 11 });
      fire(document, 'pointerup');
      vi.advanceTimersByTime(200);
    }
    expect(grip.setPointerCapture).toHaveBeenCalledTimes(1);
    expect(grip.setPointerCapture).toHaveBeenCalledWith(11);
    expect(parseLine(log.mock.calls[0])).toMatchObject({ press: 1, mode: 'no-capture', captureSet: null });
    expect(parseLine(log.mock.calls[1])).toMatchObject({ press: 2, mode: 'capture', captureSet: true, hasCaptureAfterSet: true });
    // chip shows the last two lines, ready to copy
    expect(document.getElementById('tm-dnd-debug-chip')?.textContent?.split('\n')).toHaveLength(2);
  });

  it('records a pointercancel and keeps measuring until mouseup ends the press', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    installDndPointerProbe();
    const { grip } = makeGrip();
    fire(grip, 'pointerdown', { clientX: 0, clientY: 0 });
    fire(document, 'pointercancel');
    fire(document, 'mousemove', { clientX: 3, clientY: 4 });
    vi.advanceTimersByTime(500);
    expect(log).not.toHaveBeenCalled();
    fire(document, 'mouseup');
    vi.advanceTimersByTime(200);
    const s = parseLine(log.mock.calls[0]);
    expect(s).toMatchObject({ endedBy: 'mouseup', maxDistPx: 5 });
    expect((s.lifecycle as Array<[string, number]>).map(([t]) => t)).toEqual(['pointercancel', 'mouseup']);
  });

  it('blocks and counts selectstart / dragstart during the press only', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    installDndPointerProbe();
    const { grip } = makeGrip();
    fire(grip, 'pointerdown');
    expect(fire(document, 'selectstart').defaultPrevented).toBe(true);
    expect(fire(document, 'dragstart').defaultPrevented).toBe(true);
    fire(document, 'pointerup');
    vi.advanceTimersByTime(200);
    expect(fire(document, 'selectstart').defaultPrevented).toBe(false);
  });

  it('ignores presses that are not on a drag grip, and non-primary buttons', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    installDndPointerProbe();
    const { grip, other } = makeGrip();
    fire(other, 'pointerdown');
    fire(grip, 'pointerdown', { button: 2 });
    fire(document, 'pointerup');
    vi.advanceTimersByTime(200);
    expect(log).not.toHaveBeenCalled();
  });

  it('ends with endedBy "timeout" if no release ever arrives', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    installDndPointerProbe();
    const { grip } = makeGrip();
    fire(grip, 'pointerdown');
    vi.advanceTimersByTime(20_001);
    expect(parseLine(log.mock.calls[0])).toMatchObject({ endedBy: 'timeout' });
  });

  it('the disposer removes the pointerdown listener', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const dispose = installDndPointerProbe();
    dispose();
    const { grip } = makeGrip();
    fire(grip, 'pointerdown');
    fire(document, 'pointerup');
    vi.advanceTimersByTime(200);
    expect(log).not.toHaveBeenCalled();
  });
});
