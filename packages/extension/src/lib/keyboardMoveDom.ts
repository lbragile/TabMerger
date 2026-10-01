import { gapRectFor, translateY } from '@/lib/keyboardMoveGhost';
import type { MarkerSpec, MoveTarget } from '@/lib/keyboardMove';

/**
 * DOM side of keyboard move mode's "the moving copy is always on screen" guarantee: where
 * the docked ghost goes for a target (row gap, end of a list, or a drop zone) and how the
 * scroll containers are moved so that spot is visible. Pure measurement + scrolling, no state.
 */

/** Min height of a drop zone's box while it is the keyboard target: room for the docked copy above the zone's label. */
export const KEYBOARD_ZONE_MIN_HEIGHT = 'min-h-[4.5rem]';

/** Horizontal inset (rem) of the ghost inside a drop zone, so the zone's highlighted frame stays visible around it. */
const ZONE_INSET_REM = 0.5;

const esc = (id: string) => id.replace(/["\\]/g, '\\$&');

/** Row element for a model id (tab row, window card, sidebar group row). */
export const rowFor = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-tm-dnd-id="${esc(id)}"]`);

/** The element a marker points at. */
export function markerElement(marker: MarkerSpec): HTMLElement | null {
  if (!marker) return null;
  if (marker.type === 'zone') {
    return document.querySelector<HTMLElement>(
      marker.zone === 'new-window' ? '[data-testid="new-window-dropzone"]' : '[data-testid="new-group-dropzone"]'
    );
  }
  return rowFor(marker.elementId);
}

/** The sortable list element that holds a gap (`data-tm-dnd-list` carries its container key). */
const listFor = (key: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-tm-dnd-list="${esc(key)}"]`);

export interface DockRect {
  left: number;
  top: number;
  width: number;
  /** Height of the span to scroll into view when it is not the copy's own (a zone: the zone, not a tall copy over it). */
  reveal?: number;
}

const rootRem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const px = (v: string) => parseFloat(v) || 0;

/**
 * Where a list's gap sits when it is at the END of the list (or the list has no rows):
 * under the last laid-out row, else at the top of the list's content box. Uses layout
 * positions, so it is already final while the rows are still animating.
 */
function listEndRect(list: HTMLElement): DockRect {
  const r = list.getBoundingClientRect();
  const cs = getComputedStyle(list);
  const left = r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
  const width = r.width - px(cs.borderLeftWidth) - px(cs.borderRightWidth) - px(cs.paddingLeft) - px(cs.paddingRight);
  let top = r.top + px(cs.borderTopWidth) + px(cs.paddingTop);
  const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-tm-dnd-id]')).filter(
    (el) => el.closest('[data-tm-dnd-list]') === list && el.getBoundingClientRect().height > 0
  );
  const last = rows[rows.length - 1];
  if (last) top = last.getBoundingClientRect().bottom - translateY(last) + px(getComputedStyle(last).marginBottom);
  return { left, top, width };
}

/** The ghost sits over a drop zone, centred and inset so the zone's frame shows around it. */
function zoneRect(zone: HTMLElement): DockRect {
  const r = zone.getBoundingClientRect();
  const inset = ZONE_INSET_REM * rootRem();
  return { left: r.left + inset, top: r.top + 2, width: Math.max(0, r.width - 2 * inset), reveal: r.height };
}

/** Where the docked copy goes for `target`, or `null` when nothing it points at is rendered. */
export function dockRectFor(target: MoveTarget | null, gapHeight: number): DockRect | null {
  if (!target) return null;
  const { marker } = target;
  if (marker?.type === 'zone') {
    const zone = markerElement(marker);
    return zone ? zoneRect(zone) : null;
  }
  if (marker?.type === 'line') {
    const line = gapRectFor(marker, markerElement(marker), gapHeight);
    if (line) return line;
  }
  // Empty window, window-append and "origin" targets: the end of the list that holds the gap.
  const key = target.gap.containerKey;
  const list = key ? listFor(key) : null;
  return list ? listEndRect(list) : null;
}

/** The element a target is anchored to, whose scroll ancestors must show the copy. */
export function anchorFor(target: MoveTarget | null): HTMLElement | null {
  if (!target) return null;
  const el = markerElement(target.marker);
  if (el) return el;
  const key = target.gap.containerKey;
  return key ? listFor(key) : null;
}

/** Scrollable ancestors of `el`, innermost first. */
function scrollParents(el: HTMLElement, onlyScrollable = true): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && (!onlyScrollable || p.scrollHeight > p.clientHeight)) out.push(p);
  }
  return out;
}

/** Visible client box of a scroll container, in viewport coordinates. */
function clientBox(p: HTMLElement): { top: number; bottom: number } {
  const r = p.getBoundingClientRect();
  const top = r.top + p.clientTop;
  return { top, bottom: top + p.clientHeight };
}

/** Last absolute scroll target requested per container, so a smooth scroll is not restarted every frame. */
const requested = new WeakMap<HTMLElement, number>();

/**
 * Scroll every scrollable ancestor of `anchor` the minimum distance (nearest edge, never
 * centred) so the vertical span `[top, bottom]` is visible; a span taller than the container
 * shows its top. `smooth` follows the reduced-motion preference; otherwise scrolls instantly.
 */
export function revealSpan(anchor: HTMLElement, span: { top: number; bottom: number }, behavior: ScrollBehavior): void {
  let { top, bottom } = span;
  for (const p of scrollParents(anchor)) {
    const box = clientBox(p);
    let delta = 0;
    if (bottom - top > box.bottom - box.top || top < box.top) delta = top - box.top;
    else if (bottom > box.bottom) delta = bottom - box.bottom;
    if (Math.abs(delta) < 0.5) continue;
    const max = p.scrollHeight - p.clientHeight;
    const want = Math.min(Math.max(p.scrollTop + delta, 0), max);
    const applied = want - p.scrollTop;
    if (behavior === 'smooth') {
      if (Math.abs((requested.get(p) ?? -1) - want) >= 1) {
        requested.set(p, want);
        p.scrollTo({ top: want, behavior });
      }
    } else {
      requested.delete(p);
      p.scrollTop = want;
    }
    // The outer containers see this span where the (instant) inner scroll moved it.
    if (behavior !== 'smooth') {
      top -= applied;
      bottom -= applied;
    }
  }
}

/** Keep a docked rect inside the visible area of the anchor's scroll containers (taller-than-visible: top-aligned). */
export function clampToVisible(anchor: HTMLElement, rect: DockRect, height: number): DockRect {
  let top = rect.top;
  for (const p of scrollParents(anchor, false)) {
    const box = clientBox(p);
    top = Math.max(Math.min(top, box.bottom - height), box.top);
  }
  return top === rect.top ? rect : { ...rect, top };
}
