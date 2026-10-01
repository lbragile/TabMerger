/**
 * useDndSensors.test.ts — regression cover for "DnD doesn't even start in the MV3
 * toolbar action popup".
 *
 * DEFINITIVE root cause (real-popup `tm_dnd_debug` capture, three drags): the
 * toolbar popup delivers only the FIRST sub-5px `pointermove` after `pointerdown`
 * then withholds the rest of the move stream until `pointerup`. `setPointerCapture`
 * succeeds but does not restore the stream. So dnd-kit's `{ distance: 5 }`
 * threshold is never crossed and NO Pointer/Mouse sensor can start a drag there.
 * The identical build drags fine when `popup.html` is opened as a normal tab.
 *
 * Fix: the primary sensor is `Html5DragSensor` (`@/lib/dndHtml5Sensor`) — a
 * dnd-kit sensor backed by the native HTML5 Drag and Drop API, whose
 * `dragstart` / `dragover` / `drop` / `dragend` events ARE delivered to the
 * popup because the browser's own drag loop drives them.
 *
 * This test pins the sensor SET so a refactor can't reintroduce a move-delta
 * sensor (`PointerSensor` / `MouseSensor` / a `setPointerCapture` subclass) —
 * every one of those is dead in the real popup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

interface Captured {
  name: string;
  options: unknown;
}
const captured: Captured[] = [];

vi.mock('@dnd-kit/core', () => ({
  PointerSensor: class PointerSensor {},
  MouseSensor: class MouseSensor {},
  TouchSensor: class TouchSensor {},
  KeyboardSensor: class KeyboardSensor {},
  useSensor: (sensor: { name: string }, options: unknown) => {
    captured.push({ name: sensor.name, options });
    return { sensor, options };
  },
  useSensors: (...sensors: unknown[]) => sensors,
}));
vi.mock('@dnd-kit/sortable', () => ({
  sortableKeyboardCoordinates: vi.fn(),
}));

import { useDndSensors } from '@/hooks/useDnd';

function names(): string[] {
  return captured.map((c) => c.name);
}

beforeEach(() => {
  captured.length = 0;
});

describe('useDndSensors — MV3 action-popup sensor set', () => {
  it('composes exactly two sensors (drag + touch; keyboard moves are a separate move mode)', () => {
    renderHook(() => useDndSensors());
    expect(captured).toHaveLength(2);
  });

  it('uses the native-HTML5-drag sensor, never a move-delta MouseSensor / PointerSensor', () => {
    renderHook(() => useDndSensors());
    expect(names()).toContain('Html5DragSensor');
    expect(names()).not.toContain('MouseSensor');
    expect(names()).not.toContain('PointerSensor');
    expect(names()).not.toContain('Mv3PointerSensor');
  });

  it('registers the drag sensor with no move-delta activation constraint (native browser threshold handles it)', () => {
    renderHook(() => useDndSensors());
    const drag = captured.find((c) => c.name === 'Html5DragSensor');
    expect(drag).toBeDefined();
    expect(drag?.options).toBeUndefined();
  });

  it('registers a TouchSensor with a delay/tolerance constraint (touchscreen laptops)', () => {
    renderHook(() => useDndSensors());
    const touch = captured.find((c) => c.name === 'TouchSensor');
    expect(touch).toBeDefined();
    expect(touch?.options).toEqual({ activationConstraint: { delay: 200, tolerance: 6 } });
  });

  it('has NO dnd-kit KeyboardSensor: keyboard moves go through move mode (Enter/Tab can never drop a drag)', () => {
    renderHook(() => useDndSensors());
    expect(names()).not.toContain('KeyboardSensor');
  });
});

describe('useDndSensors — diagnostic pointer-probe flag', () => {
  type Composed = Array<{ sensor: { name: string } }>;

  afterEach(() => {
    localStorage.clear();
  });

  it('with the flag UNSET the composed set is Html5DragSensor, TouchSensor', () => {
    const { result } = renderHook(() => useDndSensors());
    expect((result.current as unknown as Composed).map((s) => s.sensor.name)).toEqual([
      'Html5DragSensor',
      'TouchSensor'
    ]);
  });

  it('with tm_dnd_pointer_probe=1 at popup load, Html5DragSensor is left OUT (so no drag can start during the probe)', async () => {
    localStorage.setItem('tm_dnd_pointer_probe', '1');
    vi.resetModules();
    const mod = await import('@/hooks/useDnd');
    const { result } = renderHook(() => mod.useDndSensors());
    expect((result.current as unknown as Composed).map((s) => s.sensor.name)).toEqual(['TouchSensor']);
  });
});
