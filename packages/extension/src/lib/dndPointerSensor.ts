import type { Sensor } from '@dnd-kit/core';
import { dndDebugLog } from './dndDebug';

/** dnd-kit sensor options carried by the pointer sensor in this app. */
type PointerOpts = { activationConstraint?: { distance: number } };
type PointerSensorClass = Sensor<PointerOpts>;

/**
 * Pointer sensor for the ONE unified popup drag layer — adds explicit pointer
 * capture on top of dnd-kit's stock `PointerSensor`.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * In a real MV3 *toolbar action popup* (clicking the extension's toolbar icon),
 * Chrome does NOT deliver a `pointermove` / `mousemove` stream to the popup
 * document after `pointerdown` while a mouse button is held — UNLESS the pressed
 * element holds an explicit pointer capture. The action popup is a borderless,
 * always-on-top widget that never gets implicit mouse capture, and Chrome
 * coalesces / drops its move samples. dnd-kit's stock `PointerSensor` and
 * `MouseSensor` both attach their move listeners to `ownerDocument` and never
 * call `setPointerCapture`, so in the popup the `{ distance: 5 }` activation
 * constraint is never satisfied → `onDragStart` never fires → "the drag never
 * starts". The identical build works when `popup.html` is opened as a normal
 * browser tab because a tab gets the full, uncoalesced pointer stream regardless
 * of capture — which is exactly why the DnD rework looked fine in a tab but was
 * dead in the toolbar popup.
 *
 * ── The fix ─────────────────────────────────────────────────────────────────
 * On activation, call `target.setPointerCapture(pointerId)`. Captured pointer
 * events still follow normal capture/bubble propagation, so they reach
 * `document` and dnd-kit's existing document-level `pointermove` / `pointerup`
 * listeners fire in BOTH environments. `MouseSensor` can't be used for this —
 * `setPointerCapture` only affects Pointer Events, not `mousemove`. Capture is
 * released implicitly by the browser on `pointerup` / `pointercancel`; we also
 * release defensively and log each lifecycle stage behind the `tm_dnd_debug`
 * flag (see `@/lib/dndDebug`).
 *
 * NOTE (2026-09): DEAD END, kept for the record. Definitive real-popup evidence
 * (three drags, `tm_dnd_debug` on) showed the toolbar popup delivers only the
 * FIRST sub-5px `pointermove` after `pointerdown` then withholds the rest until
 * `pointerup`. `pointer-capture-set` logs (the call succeeds) but the move
 * stream never resumes — `setPointerCapture` cannot fix this. `useDndSensors()`
 * now uses the native-HTML5-drag `@/lib/dndHtml5Sensor` instead; this module is
 * NO LONGER imported anywhere in the runtime path.
 *
 * The base `PointerSensor` class is injected by the caller (`useDndSensors`)
 * rather than imported here: `class X extends PointerSensor` evaluates the base
 * at module-eval time, and many unit-test files mock `@dnd-kit/core` with an
 * incomplete factory that omits `PointerSensor`. Keeping the `@dnd-kit/core`
 * import out of this module means those mocks don't need updating.
 */

interface PointerSensorLikeProps {
  event: Event & Partial<PointerEvent>;
  [k: string]: unknown;
}

type PointerCaptureTarget = Element & {
  setPointerCapture?: (id: number) => void;
  releasePointerCapture?: (id: number) => void;
  hasPointerCapture?: (id: number) => boolean;
};

type AnyCtor = new (props: PointerSensorLikeProps) => object;

let cachedBase: PointerSensorClass | null = null;
let cachedSensor: PointerSensorClass | null = null;

/**
 * Build (once, cached per base class) the MV3 pointer-capture sensor as a
 * subclass of the given dnd-kit `PointerSensor`.
 */
export function getMv3PointerSensor(BasePointerSensor: PointerSensorClass): PointerSensorClass {
  if (cachedSensor && cachedBase === BasePointerSensor) return cachedSensor;

  class Mv3PointerSensor extends (BasePointerSensor as unknown as AnyCtor) {
    constructor(props: PointerSensorLikeProps) {
      super(props);

      const nativeEvent = props.event as Partial<PointerEvent> & { target: EventTarget | null };
      const target = (nativeEvent?.target ?? null) as PointerCaptureTarget | null;
      const pointerId =
        typeof nativeEvent?.pointerId === 'number' ? nativeEvent.pointerId : null;

      // SVGElement.className is an SVGAnimatedString, not a string — read the attr.
      const cls = target?.getAttribute?.('class') ?? '';
      dndDebugLog('press-registered', {
        pointerId,
        target: target ? `${target.tagName?.toLowerCase()}.${cls.slice(0, 40)}` : null
      });

      if (!target || pointerId == null || typeof target.setPointerCapture !== 'function') {
        dndDebugLog('pointer-capture-skipped', {
          hasTarget: !!target,
          pointerId,
          hasApi: !!target && typeof target.setPointerCapture === 'function'
        });
        return;
      }

      try {
        target.setPointerCapture(pointerId);
        dndDebugLog('pointer-capture-set', { pointerId });
      } catch (err) {
        dndDebugLog('pointer-capture-error', String(err));
        return;
      }

      const onFirstMove = (e: Event) => {
        const pe = e as PointerEvent;
        dndDebugLog('first-move-seen', { x: pe.clientX, y: pe.clientY });
        target.removeEventListener('pointermove', onFirstMove);
      };

      const release = () => {
        try {
          if (target.hasPointerCapture?.(pointerId)) {
            target.releasePointerCapture?.(pointerId);
            dndDebugLog('pointer-capture-released', { pointerId });
          }
        } catch {
          /* ignore */
        }
        target.removeEventListener('pointermove', onFirstMove);
        target.removeEventListener('pointerup', release);
        target.removeEventListener('pointercancel', release);
        target.removeEventListener('lostpointercapture', onLost);
      };

      const onLost = () => {
        dndDebugLog('lostpointercapture', { pointerId });
        release();
      };

      target.addEventListener('pointermove', onFirstMove);
      target.addEventListener('pointerup', release);
      target.addEventListener('pointercancel', release);
      target.addEventListener('lostpointercapture', onLost);
    }
  }

  // dnd-kit reads `SensorClass.activators` to bind the `onPointerDown` activator.
  // `extends` already inherits it through the prototype chain; pin it as an own
  // property too so a partial mock / bundler transform can't drop it.
  (Mv3PointerSensor as unknown as { activators?: unknown }).activators = (
    BasePointerSensor as unknown as { activators?: unknown }
  ).activators;

  cachedBase = BasePointerSensor;
  cachedSensor = Mv3PointerSensor as unknown as PointerSensorClass;
  return cachedSensor;
}

/** Test hook — drop the cached subclass so a fresh base class is picked up. */
export function resetMv3PointerSensorCache(): void {
  cachedBase = null;
  cachedSensor = null;
}
