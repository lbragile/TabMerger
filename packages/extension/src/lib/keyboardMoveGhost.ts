import { buildDragGhost } from '@/lib/dndDragVisuals';
import { getDndAuxHost } from '@/lib/dndGhostHost';
import type { MarkerSpec } from '@/lib/keyboardMove';

/**
 * The floating copy of the moving item(s) for keyboard move mode: the SAME ghost the
 * pointer drag shows (`buildDragGhost`, a faithful clone with the `+N` badge for a
 * selection), parented in the permanent aux host. A pointer drag moves it with the mouse;
 * here it is DOCKED in the insertion gap of the current target, so the preview reads as
 * "the item sits where the gap is".
 */
export interface MoveGhost {
  /** Dock the ghost at `rect` (viewport coords); `null` hides it (zone and window targets have no row gap). */
  place: (rect: { left: number; top: number; width: number } | null) => void;
  /** The copy's rendered height, for placing / revealing it. */
  height: () => number;
  /** The badge shows the number of items being moved: `+{count-1}` beside the one shown, none for a single item. */
  setCount: (count: number) => void;
  remove: () => void;
}

/** Build the ghost from `row` BEFORE the row is collapsed (a collapsed clone would be empty). */
export function createMoveGhost(row: HTMLElement, count: number): MoveGhost | null {
  const host = getDndAuxHost();
  if (!host) return null;
  const el = buildDragGhost(row, row.getBoundingClientRect(), { count });
  // Docked over a zone or an empty window the copy must not let the text under it show through (a tab row has no background).
  el.classList.add('bg-card');
  host.appendChild(el);
  return {
    place(rect) {
      if (!rect) {
        el.style.transform = 'translate3d(-9999px, -9999px, 0)';
        return;
      }
      el.style.width = `${Math.round(rect.width)}px`;
      el.style.transform = `translate3d(${Math.round(rect.left)}px, ${Math.round(rect.top)}px, 0)`;
    },
    height: () => el.offsetHeight,
    setCount(next) {
      const rest = Math.max(0, Math.floor(next) - 1);
      const badge = el.querySelector('[data-testid="drag-ghost-count"]');
      if (badge && rest > 0) badge.textContent = `+${rest}`;
      else badge?.remove();
      // One card behind the shown item per other item, the nearest ones kept.
      const stack = el.querySelectorAll('[data-testid="drag-ghost-stack"]');
      stack.forEach((card, i) => {
        if (i < stack.length - rest) card.remove();
      });
    },
    remove() {
      el.remove();
    }
  };
}

/** Vertical translation currently applied to `el` (rows displaced by the gap animate through it). */
export function translateY(el: HTMLElement): number {
  if (typeof getComputedStyle !== 'function') return 0;
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;
  const m3 = /^matrix3d\((.+)\)$/.exec(t);
  if (m3) return parseFloat(m3[1].split(',')[13] ?? '0') || 0;
  const m2 = /^matrix\((.+)\)$/.exec(t);
  return m2 ? parseFloat(m2[1].split(',')[5] ?? '0') || 0 : 0;
}

/**
 * Where the gap of a slot target sits on screen, from its anchor row, in LAYOUT terms (the
 * row's current displacement is taken out), so it is already final while the rows animate.
 * A "before" slot's anchor row is displaced down by the gap, so the gap opens where the row
 * sits in layout; an "after" slot's gap opens below the last row (plus its bottom margin,
 * which the outer height of the next row would have included).
 */
export function gapRectFor(
  marker: MarkerSpec,
  el: HTMLElement | null,
  _height: number
): { left: number; top: number; width: number } | null {
  if (!marker || marker.type !== 'line' || !el) return null;
  const r = el.getBoundingClientRect();
  const dy = translateY(el);
  const marginBottom = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(el).marginBottom) || 0 : 0;
  return { left: r.left, top: marker.side === 'before' ? r.top - dy : r.bottom - dy + marginBottom, width: r.width };
}
