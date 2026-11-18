import { useCallback, useEffect, useRef, useState } from 'react';

/** How close to an end (px) still counts as "at" it: sub-pixel scroll positions never reach 0 exactly. */
const EDGE_SLACK = 2;

export interface ScrollFades {
  /** Scrolled away from the top: show the top fade. */
  top: boolean;
  /** More content below: show the bottom fade. */
  bottom: boolean;
}

/**
 * Which edge fades a scroll area shows: the top one once it is scrolled, the bottom one while
 * there is more below. Measured on scroll and whenever the area or its content changes size
 * (a `ResizeObserver` on both), at most once a frame; state only changes when an answer does,
 * so a long list re-renders twice per scroll at most (leaving the top, reaching the end).
 *
 * @returns a callback ref for the scroll container, and the two flags.
 */
export function useScrollFades<T extends HTMLElement>(): { ref: (el: T | null) => void; fades: ScrollFades } {
  const [fades, setFades] = useState<ScrollFades>({ top: false, bottom: false });
  const [el, setEl] = useState<T | null>(null);
  const frame = useRef<number | null>(null);

  const measure = useCallback((node: T) => {
    const top = node.scrollTop > EDGE_SLACK;
    const bottom = node.scrollTop + node.clientHeight < node.scrollHeight - EDGE_SLACK;
    setFades((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, []);

  useEffect(() => {
    if (!el) return;
    const schedule = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        measure(el);
      });
    };
    measure(el);
    el.addEventListener('scroll', schedule, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', schedule);
      observer?.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [el, measure]);

  return { ref: setEl, fades };
}
