/**
 * A `<div>` appended to `<body>` ONCE (permanent sibling of `#root`, never
 * added/removed after boot). Transient drag-image clones are parented here.
 *
 * Why: in the real MV3 toolbar action popup, adding/removing DOM that is an
 * ANCESTOR of the dragged grip mid-drag aborts the native HTML5 drag. This host
 * is never an ancestor of any grip, so mutating its subtree during a drag is
 * safe. See `@/lib/dndHtml5Sensor`.
 */
export function getDndAuxHost(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  let host = document.getElementById('tm-dnd-aux-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'tm-dnd-aux-host';
    host.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483646';
    (document.body ?? document.documentElement)?.appendChild(host);
  }
  return host;
}

// Create the host EAGERLY at popup boot so no `<body>` child is added later.
// A body-child mutation during `dragstart` is tolerated (verified — it does not
// abort the native drag), but doing it once at load is cleaner.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => getDndAuxHost(), { once: true });
  } else {
    getDndAuxHost();
  }
}
