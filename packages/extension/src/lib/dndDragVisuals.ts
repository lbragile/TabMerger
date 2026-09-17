import { DND_ROW_ID_ATTR } from './dndMultiDrag';

/**
 * Sensor-agnostic drag VISUALS: the lifted ghost (a faithful row clone, optionally with a
 * `+N` count badge and a stacked-card look) and the source-row collapse with exact
 * restore. `Html5DragSensor` calls these; a future pointer-driven sensor can too.
 *
 * Everything here writes DOM directly (no React). Callers own the timing rules:
 *   - the ghost lives in `#tm-dnd-aux-host` (never a grip ancestor) → safe any time
 *   - collapsing rows moves layout → ONLY from the first rAF after `dragstart` (spec C4)
 */

export type DragRowKind = 'tab' | 'window' | 'group';

export interface RowRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

// ─── cursor ──────────────────────────────────────────────────────────────────

/**
 * Attribute set on `<html>` for the duration of a POINTER-driven drag. `globals.css`
 * forces `cursor: grabbing !important` on every element under it.
 *
 * Why an attribute + a static `!important` rule rather than `document.body.style.cursor`:
 * `cursor` inherits, but practically every row/button in the popup sets its own
 * (`cursor-grab`, `cursor-pointer`, …), so a `<body>` inline value is overridden the
 * moment the pointer is over anything interactive — which is the whole drag.
 *
 * This is INERT during a NATIVE HTML5 drag (spec C5: the OS owns the cursor then, and
 * `dropEffect` only picks among OS glyphs), which is exactly why the dual-path sensor
 * exists: on the pointer path there is no native drag session, so CSS `cursor` applies.
 */
export const DND_GRABBING_ATTR = 'data-tm-dnd-grabbing';

export function setDndGrabbingCursor(on: boolean): void {
  try {
    if (typeof document === 'undefined' || !document.documentElement) return;
    if (on) document.documentElement.setAttribute(DND_GRABBING_ATTR, '');
    else document.documentElement.removeAttribute(DND_GRABBING_ATTR);
  } catch {
    /* cosmetic — never break a drag */
  }
}

/** Outer height (rect + vertical margins) — the size of the slot a collapsed row leaves. */
export function outerHeight(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  return rect.height + (parseFloat(cs?.marginTop ?? '') || 0) + (parseFloat(cs?.marginBottom ?? '') || 0);
}

// ─── collapse ────────────────────────────────────────────────────────────────

/** Inline `!important` styles that take a row out of the layout. */
const COLLAPSE_STYLES: ReadonlyArray<[string, string]> = [
  ['height', '0px'],
  ['min-height', '0px'],
  ['max-height', '0px'],
  ['padding-top', '0px'],
  ['padding-bottom', '0px'],
  ['margin-top', '0px'],
  ['margin-bottom', '0px'],
  ['border-top-width', '0px'],
  ['border-bottom-width', '0px'],
  ['overflow', 'hidden'],
  ['visibility', 'hidden']
];

export interface MeasuredRow {
  row: HTMLElement;
  /** positional model id (`data-tm-dnd-id`), when the row carries one */
  id: string | null;
  /** pre-collapse viewport rect */
  rect: RowRect;
  /** pre-collapse outer height */
  height: number;
}

/** Measure rows BEFORE collapsing any of them (a collapse would shift the ones below). */
export function measureRows(rows: HTMLElement[]): MeasuredRow[] {
  return rows
    .filter((row) => row.isConnected)
    .map((row) => {
      const r = row.getBoundingClientRect();
      return {
        row,
        id: row.getAttribute(DND_ROW_ID_ATTR),
        rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        height: outerHeight(row)
      };
    });
}

export interface CollapseHandle {
  rows: MeasuredRow[];
  /** Put every row's prior inline values back exactly (idempotent). */
  restore(): void;
}

/**
 * Collapse every measured row: zero height / padding / margin / vertical borders +
 * `overflow:hidden` + `visibility:hidden`, all inline `!important`, prior inline values
 * kept. Zero HEIGHT rather than `display:none` on purpose: dnd-kit re-measures the
 * active node through a ResizeObserver, and a `display:none` node measures as a 0×0
 * rect at (0,0), which drags every rect-based collision fallback to the top-left
 * corner; a 0-height row keeps its top/left/width.
 */
export function collapseRows(measured: MeasuredRow[]): CollapseHandle {
  const saved: Array<{ row: HTMLElement; prev: Array<[string, string, string]> }> = [];
  for (const { row } of measured) {
    try {
      const prev: Array<[string, string, string]> = [];
      for (const [prop, value] of COLLAPSE_STYLES) {
        prev.push([prop, row.style.getPropertyValue(prop), row.style.getPropertyPriority(prop)]);
        row.style.setProperty(prop, value, 'important');
      }
      saved.push({ row, prev });
    } catch {
      /* cosmetic — never break a drag */
    }
  }
  let restored = false;
  return {
    rows: measured,
    restore() {
      if (restored) return;
      restored = true;
      for (const { row, prev } of saved) {
        for (const [prop, value, priority] of prev) {
          try {
            if (value) row.style.setProperty(prop, value, priority);
            else row.style.removeProperty(prop);
          } catch {
            /* ignore */
          }
        }
      }
    }
  };
}

// ─── ghost ───────────────────────────────────────────────────────────────────

export function dragRowKind(row: HTMLElement): DragRowKind {
  if (row.matches('[data-sidebar-group-index]')) return 'group';
  if (row.matches('[role="listitem"]')) return 'tab';
  return 'window';
}

const IDENTITY_ATTRS = [
  'id',
  'data-testid',
  'draggable',
  'data-window-index',
  'data-tab-index',
  'data-group-index',
  'data-sidebar-group-index',
  DND_ROW_ID_ATTR
];

/**
 * A FAITHFUL CLONE of the actual dragged row (`row.cloneNode(true)`). `cloneNode`
 * preserves every `class` attribute, so the global stylesheet resolves them identically
 * wherever the clone lives (no shadow DOM); inline styles are copied verbatim; CSS custom
 * properties resolve because they're set on `document.documentElement`.
 */
function sanitizeGhostClone(clone: HTMLElement): void {
  for (const attr of IDENTITY_ATTRS) clone.removeAttribute(attr);
  clone.querySelectorAll(IDENTITY_ATTRS.map((a) => `[${a}]`).join(',')).forEach((el) => {
    for (const attr of IDENTITY_ATTRS) el.removeAttribute(attr);
  });
  // Laid out standalone inside the wrapper — a stray `mb-2` would add dead space (and can
  // defeat the window ghost's max-height clamp via margin collapsing).
  clone.style.margin = '0';
  // `cloneNode` never copies listeners, and React's delegated `onError` (Tab.tsx favicon
  // fallback) is rooted at `#root` — it never fires for a clone outside `#root`.
  clone.querySelectorAll('img').forEach((img) => {
    img.addEventListener('error', () => {
      img.style.visibility = 'hidden';
    });
  });
}

/**
 * Literal colors only: `--primary` etc. are bare HSL triplets, so a raw `var(--primary)`
 * is invalid inline and renders transparent (spec §7). Theme colors go through CLASSES.
 */
const GHOST_SHADOW =
  '0 0 0 1.5px hsla(193, 90%, 55%, 0.7), 0 22px 44px rgba(0,0,0,0.5), 0 8px 18px rgba(0,0,0,0.35)';
const STACK_SHADOW = '0 6px 14px rgba(0,0,0,0.35)';
const WINDOW_GHOST_MAX_HEIGHT = 440;
/** Offsets (px) of the cards peeking out behind the front card of a multi-item ghost. */
const STACK_OFFSETS = [10, 5];

/**
 * Build the ghost for `row` (not yet attached). `count > 1` → a multi-item ghost: the
 * row clone sits on a solid front card with up to two offset cards behind it and a
 * `+{count-1}` badge in its top-right corner (the primary item is the one shown; the
 * badge counts the rest). Position is the caller's job (`style.transform` per frame).
 */
export function buildDragGhost(row: HTMLElement, rect: DOMRect, opts: { count?: number } = {}): HTMLElement {
  const kind = dragRowKind(row);
  const count = Math.max(1, Math.floor(opts.count ?? 1));
  const multi = count > 1;

  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-testid', 'drag-ghost');
  wrapper.setAttribute('aria-hidden', 'true');
  // `inert` removes the subtree from focus/pointer/AT on top of `pointer-events:none`.
  try {
    wrapper.setAttribute('inert', '');
  } catch {
    /* non-fatal */
  }
  const width = rect.width > 0 ? rect.width : row.offsetWidth || 200;
  Object.assign(wrapper.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    margin: '0',
    transform: 'translate3d(-9999px, -9999px, 0) scale(1)',
    willChange: 'transform',
    zIndex: '2147483646',
    pointerEvents: 'none',
    width: `${Math.round(width)}px`,
    opacity: '1',
    // Belt with `DND_GRABBING_ATTR`'s braces: the ghost is `pointer-events:none`, so it
    // never resolves the cursor itself, but a stray hit test must not read `auto`.
    cursor: 'grabbing'
  } as Partial<CSSStyleDeclaration>);

  // Single item: the wrapper IS the card (unchanged from the phase-1 ghost).
  // Multi: the wrapper only positions; a solid front card holds the clone.
  const front = multi ? document.createElement('div') : wrapper;
  const clampedHeight = Math.min(rect.height, WINDOW_GHOST_MAX_HEIGHT);
  const isClipped = kind === 'window' && rect.height > clampedHeight;
  Object.assign(front.style, {
    boxShadow: GHOST_SHADOW,
    overflow: kind === 'window' ? 'hidden' : 'visible'
  } as Partial<CSSStyleDeclaration>);
  if (kind === 'window') front.style.maxHeight = `${Math.round(clampedHeight)}px`;

  if (multi) {
    for (const offset of STACK_OFFSETS.slice(STACK_OFFSETS.length - Math.min(count - 1, STACK_OFFSETS.length))) {
      const card = document.createElement('div');
      card.setAttribute('data-testid', 'drag-ghost-stack');
      card.className = 'bg-card border border-border';
      Object.assign(card.style, {
        position: 'absolute',
        top: `${offset}px`,
        left: `${offset}px`,
        width: '100%',
        height: '100%',
        boxShadow: STACK_SHADOW
      } as Partial<CSSStyleDeclaration>);
      wrapper.appendChild(card);
    }
    front.setAttribute('data-testid', 'drag-ghost-front');
    // A tab row has no background of its own — the offset cards would show through it.
    front.className = 'bg-card';
    front.style.position = 'relative';
    wrapper.appendChild(front);
  }

  const clone = row.cloneNode(true) as HTMLElement;
  sanitizeGhostClone(clone);
  front.appendChild(clone);

  if (isClipped) {
    // Subtle bottom fade so a clipped tall window doesn't end in a hard cut.
    const fade = document.createElement('div');
    fade.style.cssText =
      'position:absolute;left:0;right:0;bottom:0;height:28px;background:linear-gradient(to bottom, transparent, rgba(0,0,0,0.28));';
    front.appendChild(fade);
  }

  if (multi) {
    const badge = document.createElement('div');
    badge.setAttribute('data-testid', 'drag-ghost-count');
    badge.className =
      // foreground-on-background: white-on-primary was ~3:1 for 11px text (WCAG needs 4.5:1)
      'bg-foreground text-background text-[11px] font-semibold leading-5 text-center rounded-full px-1.5 min-w-5 h-5 tabular-nums';
    // Top-LEFT, next to the cursor: the ghost is a full row-width clone hanging to the
    // RIGHT of the pointer, so its right edge routinely runs past the popup's edge
    // (measured in the real popup — a top-right badge was off-screen mid-panel).
    Object.assign(badge.style, {
      position: 'absolute',
      top: '-9px',
      left: '-9px',
      boxShadow: '0 2px 6px rgba(0,0,0,0.45)'
    } as Partial<CSSStyleDeclaration>);
    badge.textContent = `+${count - 1}`;
    wrapper.appendChild(badge);
  }

  return wrapper;
}
