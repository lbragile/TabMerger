import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { findTourElements, measureTourHighlight, revealTourAnchor, type TourHighlight } from '@/lib/tourDom';

const sameHighlight = (a: TourHighlight | null, b: TourHighlight | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.radius === b.radius &&
    a.rect.left === b.rect.left &&
    a.rect.top === b.rect.top &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height);

/**
 * Runs `callback` once per animation frame while `enabled`. The callback is read through a ref,
 * so it may close over fresh state without restarting the loop.
 */
export function useTourFrame(callback: () => void, enabled: boolean): void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  useEffect(() => {
    if (!enabled || typeof requestAnimationFrame !== 'function') return;
    let frame = requestAnimationFrame(function tick() {
      latest.current();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled]);
}

/**
 * The visible rectangle (and corner radius) of what a step highlights, or `null` when the step
 * has nothing on the page to point at. `highlight` is the step's list of selector lists (see
 * `TourTargets.highlight`); `stepKey` changes when the step does.
 *
 * When the step changes its target is first scrolled into view inside its own scroll container.
 * After that the rectangle is re-measured on EVERY animation frame, which is what makes the ring
 * follow its target with no lag: a menu or popover growing in (a transform animation, which no
 * resize or mutation observer reports), a dialog appearing, a list reflowing, a panel being
 * scrolled. A measurement is a handful of `getBoundingClientRect` calls, and state only changes
 * when the numbers do, so an idle tour costs no renders.
 */
export function useTourHighlight(highlight: readonly (readonly string[])[], stepKey: string, enabled = true): TourHighlight | null {
  const [value, setValue] = useState<TourHighlight | null>(null);
  const latest = useRef(highlight);
  useEffect(() => {
    latest.current = highlight;
  });

  const measure = () => {
    const next = enabled ? measureTourHighlight(latest.current) : null;
    setValue((prev) => (sameHighlight(prev, next) ? prev : next));
  };

  // Before paint on a step change, so the ring never shows the previous step's rectangle
  useLayoutEffect(() => {
    latest.current = highlight;
    if (enabled) {
      const first = highlight.flatMap((selectors) => findTourElements(selectors))[0];
      if (first) revealTourAnchor(first);
    }
    measure();
    // `highlight` is rebuilt on every render: the step key is what says "a different target"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, enabled]);

  useTourFrame(measure, enabled);

  return value;
}
