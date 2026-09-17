/**
 * True when the user asked the OS for reduced motion. Read at call time (cheap), and
 * defensive for environments without `matchMedia` (jsdom, service worker).
 */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** `'auto'` (instant) under reduced motion, else `'smooth'`. */
export function motionScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
