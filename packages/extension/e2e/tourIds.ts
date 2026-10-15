import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOUR_CHAPTERS, TOUR_STEPS } from '../src/lib/tourSteps';

/** Returns `id` when the tour has a step with it, else throws: a renamed step fails the spec loudly at load, not as a stale selector. */
export function stepId(id: string): string {
  if (!TOUR_STEPS.some((s) => s.id === id)) throw new Error(`Tour step "${id}" no longer exists in src/lib/tourSteps.ts`);
  return id;
}

export const CHAPTER_COUNT = TOUR_CHAPTERS.length;
export const STEP_COUNT = TOUR_STEPS.length;
/** The tour's read-only (no task) step ids, in order. */
export const readOnlyStepIds = (): string[] => TOUR_STEPS.filter((s) => !s.task).map((s) => s.id);

/** Reads a `const NAME = <number>;` rem constant out of Tour.tsx (they are not exported), so the specs follow the source. */
function tourRem(name: string): number {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/components/Tour/Tour.tsx'), 'utf8');
  const m = src.match(new RegExp(String.raw`const ${name}\s*=\s*([0-9.]+);`));
  if (!m) throw new Error(`${name} not found in Tour.tsx`);
  return Number(m[1]);
}

/** px an action ring plus its pulse keep from the popup frame: ACTION_RING_EXTENT_REM + PULSE_TRAVEL_REM at 16px/rem. */
export const ACTION_FRAME_EDGE_PX = (tourRem('ACTION_RING_EXTENT_REM') + tourRem('PULSE_TRAVEL_REM')) * 16;

/** px the region ring plus its pulse keep from the popup frame: RING_EXTENT_REM + PULSE_TRAVEL_REM. */
export const FRAME_EDGE_PX = (tourRem('RING_EXTENT_REM') + tourRem('PULSE_TRAVEL_REM')) * 16;
