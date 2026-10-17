/**
 * Stops `resize` events that report no change in the window's size from reaching any other
 * listener on that window, until the returned cleanup runs.
 *
 * Why: Firefox sizes a browser-action popup to its content. After every DOM change it measures
 * the page again and resizes the popup, and the popup window then fires `resize` even when the
 * size is still the same (800×600 here). Radix Select closes itself on any window `resize`, so
 * in a Firefox popup it closed the moment it opened: mounting its own list is a DOM change.
 * A `resize` whose size really changed still goes through, so Chrome, Edge and a real window
 * resize behave exactly as before.
 *
 * The listener is a capture listener on the window, so it runs before the window's ordinary
 * listeners (capture listeners run first at the target), whichever was added first.
 *
 * @param win The window whose same-size `resize` events should be stopped.
 * @returns A cleanup that removes the listener.
 */
export function stopSameSizeResizes(win: Window): () => void {
  let width = win.innerWidth;
  let height = win.innerHeight;

  const onResize = (event: Event): void => {
    if (win.innerWidth === width && win.innerHeight === height) {
      event.stopImmediatePropagation();
      return;
    }
    width = win.innerWidth;
    height = win.innerHeight;
  };

  win.addEventListener('resize', onResize, true);
  return () => win.removeEventListener('resize', onResize, true);
}
