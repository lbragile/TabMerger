/**
 * dndPointerSensor.test.ts — regression guard for the MV3-action-popup DnD fix.
 *
 * `getMv3PointerSensor(BasePointerSensor)` returns a subclass of dnd-kit's
 * `PointerSensor` that, on activation, calls `target.setPointerCapture(pointerId)`.
 * That capture is what makes Chrome deliver the post-`pointerdown` move stream to
 * a real MV3 *toolbar action popup* (a borderless widget with no implicit mouse
 * capture) — without it the `{ distance: 5 }` activation constraint is never met
 * and the drag never starts. See `@/lib/dndPointerSensor` for the full write-up.
 *
 * A minimal fake base class stands in for dnd-kit's `PointerSensor` so the
 * constructor doesn't attach real document listeners; the assertions target only
 * the behaviour this subclass ADDS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMv3PointerSensor, resetMv3PointerSensorCache } from '@/lib/dndPointerSensor';

const superProps: unknown[] = [];

class FakeBasePointerSensor {
  constructor(props: unknown) {
    superProps.push(props);
  }
  static activators = [{ eventName: 'onPointerDown', handler: () => true }];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Mv3PointerSensor = getMv3PointerSensor(FakeBasePointerSensor as any) as any;

type FakeTarget = HTMLElement & {
  setPointerCapture: ReturnType<typeof vi.fn>;
  releasePointerCapture: ReturnType<typeof vi.fn>;
  hasPointerCapture: ReturnType<typeof vi.fn>;
};

function makeTarget(withCaptureApi = true): FakeTarget {
  const el = document.createElement('span') as unknown as FakeTarget;
  el.className = 'drag-handle';
  document.body.appendChild(el);
  if (withCaptureApi) {
    let held = false;
    el.setPointerCapture = vi.fn(() => {
      held = true;
    });
    el.releasePointerCapture = vi.fn(() => {
      held = false;
    });
    el.hasPointerCapture = vi.fn(() => held);
  } else {
    (el as unknown as Record<string, unknown>).setPointerCapture = undefined;
  }
  return el;
}

function makeProps(target: FakeTarget | null, pointerId: number | undefined) {
  return { event: { target, pointerId, type: 'pointerdown' }, options: {} } as never;
}

beforeEach(() => {
  superProps.length = 0;
  document.body.innerHTML = '';
});

describe('getMv3PointerSensor', () => {
  it('caches the subclass per base class', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getMv3PointerSensor(FakeBasePointerSensor as any)).toBe(Mv3PointerSensor);
    resetMv3PointerSensorCache();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getMv3PointerSensor(FakeBasePointerSensor as any)).not.toBe(Mv3PointerSensor);
  });

  it('copies the base sensor `activators` (the onPointerDown binding) onto the subclass', () => {
    expect(Mv3PointerSensor.activators?.[0]?.eventName).toBe('onPointerDown');
  });

  it('extends the injected base class', () => {
    expect(Object.getPrototypeOf(Mv3PointerSensor)).toBe(FakeBasePointerSensor);
  });
});

describe('Mv3PointerSensor instance', () => {
  it('calls super(props) — the base PointerSensor constructor still runs', () => {
    new Mv3PointerSensor(makeProps(makeTarget(), 1));
    expect(superProps).toHaveLength(1);
  });

  it('sets pointer capture on the pressed element with the activating pointerId', () => {
    const target = makeTarget();
    new Mv3PointerSensor(makeProps(target, 42));
    expect(target.setPointerCapture).toHaveBeenCalledWith(42);
  });

  it('releases pointer capture on pointerup', () => {
    const target = makeTarget();
    new Mv3PointerSensor(makeProps(target, 5));
    target.dispatchEvent(new Event('pointerup'));
    expect(target.releasePointerCapture).toHaveBeenCalledWith(5);
  });

  it('releases pointer capture on pointercancel', () => {
    const target = makeTarget();
    new Mv3PointerSensor(makeProps(target, 9));
    target.dispatchEvent(new Event('pointercancel'));
    expect(target.releasePointerCapture).toHaveBeenCalledWith(9);
  });

  it('does not throw when the platform lacks setPointerCapture', () => {
    const target = makeTarget(false);
    expect(() => new Mv3PointerSensor(makeProps(target, 3))).not.toThrow();
    expect(superProps).toHaveLength(1);
  });

  it('does not throw when there is no event target', () => {
    expect(() => new Mv3PointerSensor(makeProps(null, 1))).not.toThrow();
  });

  it('does not throw when there is no pointerId', () => {
    const target = makeTarget();
    expect(() => new Mv3PointerSensor(makeProps(target, undefined))).not.toThrow();
    expect(target.setPointerCapture).not.toHaveBeenCalled();
  });
});
