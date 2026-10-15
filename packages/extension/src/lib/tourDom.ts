import { motionScrollBehavior } from './reducedMotion';
import { intersectRects, remToPx, scrollTopToReveal, tourAnchorSelector, unionRects, type TourRect, type TourSize } from './tour';

/** DOM side of the tour: finding anchors, measuring them, scrolling them into view, locking the app. */

/** Element the tour locks while it is open (the React root; the tour itself is a portal outside it). */
export const TOUR_APP_ROOT_ID = 'root';

/** Marks the tour's own card. Everything else with `role="dialog"` is some other surface. */
export const TOUR_CARD_SELECTOR = '[data-tour-card]';

/**
 * Any dialog of the app, never the tour's own card. The in-app confirmation is an
 * `alertdialog` (`components/Modal/ConfirmDialog.tsx`) and counts exactly like a `dialog`. One
 * compound selector (no comma), so it can be extended: `${TOUR_APP_DIALOG} > button`.
 */
export const TOUR_APP_DIALOG = ':is([role="dialog"], [role="alertdialog"]):not([data-tour-card])';

/**
 * Surfaces the APP renders outside its root while a control is open: Radix menus, popovers and
 * select lists (all inside a popper wrapper) and dialogs. While one is open and has the
 * keyboard, its own key handling and focus trap are in charge, not the tour's.
 */
export const TOUR_FOREIGN_LAYER = `[data-radix-popper-content-wrapper], ${TOUR_APP_DIALOG}`;

export function findTourAnchor(name: string | null): HTMLElement | null {
  if (!name || typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(tourAnchorSelector(name));
}

export function rootFontSize(): number {
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}

/** Converts a size authored in rem to pixels for the current root font size. */
export function tourRemToPx(rem: number): number {
  return remToPx(rem, rootFontSize());
}

/** The popup frame the spotlight and the card must stay inside. */
export function tourFrame(): TourSize {
  return { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
}

export function elementRect(el: Element): TourRect {
  const { left, top, width, height } = el.getBoundingClientRect();
  return { left, top, width, height };
}

const clips = (value: string) => value !== 'visible' && value !== '';

/**
 * The part of an element that can actually be seen: its rectangle cut by every ancestor that
 * clips its content (a scrolling list, an `overflow: hidden` panel) and by the popup frame.
 * `null` when nothing of it is visible (scrolled out of view, zero size, not rendered).
 */
export function visibleRect(el: Element): TourRect | null {
  let rect: TourRect | null = elementRect(el);
  if (rect.width <= 0 || rect.height <= 0) return null;
  let node: Element | null = el;
  while (rect && node) {
    // A fixed element is positioned by the viewport: its ancestors do not clip it
    if (getComputedStyle(node).position === 'fixed') break;
    node = node.parentElement;
    if (!node || node === document.body) break;
    const style = getComputedStyle(node);
    if (clips(style.overflowX) || clips(style.overflowY)) rect = intersectRects(rect, elementRect(node));
  }
  const frame = tourFrame();
  return rect && intersectRects(rect, { left: 0, top: 0, width: frame.width, height: frame.height });
}

const queryAll = (selector: string): HTMLElement[] => {
  try {
    return Array.from(document.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
};

export interface TourHighlight {
  rect: TourRect;
  /** Corner radius of the highlighted element in pixels (0 for a square one, or for several). */
  radius: number;
  /** Position, in the lists given, of the list that won (0 = the first, most specific one). */
  index: number;
  /** True when the bottom edge of what was measured is cut off (scrolled out of its list). */
  bottomCut: boolean;
}

/**
 * Measures what a step highlights. `groups` are lists of selectors, most specific first: the
 * first list with something visible wins, and the result is one rectangle around every visible
 * element of that list. `null` when nothing is visible (the step is then drawn centered).
 */
export function measureTourHighlight(groups: readonly (readonly string[])[]): TourHighlight | null {
  for (const [index, selectors] of groups.entries()) {
    const elements = selectors.flatMap(queryAll);
    const rects = elements.map(visibleRect).filter((r): r is TourRect => r !== null);
    const rect = unionRects(rects);
    if (!rect) continue;
    const radius = elements.length === 1 ? parseFloat(getComputedStyle(elements[0]).borderTopLeftRadius) || 0 : 0;
    const fullBottom = Math.max(...elements.map((el) => el.getBoundingClientRect().bottom));
    return { rect, radius: Math.min(radius, rect.width / 2, rect.height / 2), index, bottomCut: fullBottom > rect.top + rect.height + 1 };
  }
  return null;
}

/**
 * Attribute the tour writes on menu items and dialog buttons while a step is up: the control's
 * visible text ({@link markTourLabels}). It lets a step name a control exactly the way its text
 * does (`[data-tour-label="Open in browser"]`), for controls that carry no `data-tour` anchor.
 */
export const TOUR_LABEL_ATTR = 'data-tour-label';

const LABELED = `[role="menuitem"], ${TOUR_APP_DIALOG} button`;

/**
 * The first line of visible text inside an element: a menu item's title without the hint under
 * it, a button's whole text. It is the text of the element that holds the first words, pieces
 * joined (React renders "Remove {count} duplicates" as several text nodes).
 */
function firstText(el: Element): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.textContent ?? '').trim()) continue;
    const pieces = Array.from(node.parentNode?.childNodes ?? [node]).filter((child) => child.nodeType === Node.TEXT_NODE);
    return pieces
      .map((piece) => piece.textContent ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }
  return '';
}

/**
 * Writes {@link TOUR_LABEL_ATTR} on every menu item and dialog button on the page. Cheap (a
 * handful of elements, and only while a menu or dialog is open), and an attribute is only
 * written when its value changes, so calling it every frame causes no mutations when idle.
 */
export function markTourLabels(): void {
  document.querySelectorAll(LABELED).forEach((el) => {
    const text = firstText(el);
    if (el.getAttribute(TOUR_LABEL_ATTR) !== text) el.setAttribute(TOUR_LABEL_ATTR, text);
  });
}

/** Every element on the page matching any of the selectors. */
export function findTourElements(selectors: readonly string[]): HTMLElement[] {
  return selectors.flatMap(queryAll);
}

/** Nearest ancestor that scrolls vertically and has something to scroll, or `null`. */
export function findScrollContainer(el: Element): HTMLElement | null {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/**
 * Scrolls an anchor that is out of view back into view INSIDE its own scroll container (the
 * group list, the windows panel). Deliberately not `scrollIntoView`: that may also scroll the
 * popup's `overflow: hidden` body, which has no scrollbar to scroll back with.
 */
export function revealTourAnchor(el: Element): void {
  const container = findScrollContainer(el);
  if (!container) return;
  const top = scrollTopToReveal(elementRect(el), elementRect(container), container.scrollTop, tourRemToPx(0.5));
  if (top === null) return;
  if (typeof container.scrollTo === 'function') container.scrollTo({ top, behavior: motionScrollBehavior() });
  else container.scrollTop = top;
}

/** True when nothing of the element is cut off by a scrolling ancestor or the popup frame. */
export function isFullyVisible(el: Element): boolean {
  const full = elementRect(el);
  const seen = visibleRect(el);
  return !!seen && seen.height >= full.height - 1 && seen.width >= full.width - 1;
}

/**
 * Brings an element fully into view through EVERY scrolling ancestor (a tab inside a window's
 * own list inside the windows panel), with `padding` pixels of room above and below it. Instant,
 * not smooth: the rings are measured every frame and must not chase a moving target.
 */
export function revealTourTarget(el: Element, padding = tourRemToPx(0.5)): void {
  let node: Element = el;
  for (let depth = 0; depth < 6; depth++) {
    const container = findScrollContainer(node);
    if (!container) return;
    const top = scrollTopToReveal(elementRect(el), elementRect(container), container.scrollTop, padding);
    if (top !== null) container.scrollTop = top;
    node = container;
  }
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Controls that take focus when asked to, whatever their `tabindex` (rows here use a roving -1). */
const OPERABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

/** Selector of a toast on screen (sonner). Toasts stay usable while the tour is open. */
export const TOUR_TOAST_SELECTOR = '[data-sonner-toast]';

/** Marks an unlocked element that Tab must never land on (the keyboard move's hidden focus holder). */
export const TOUR_NO_TAB_ATTR = 'data-tour-no-tab';

/** The controls inside the elements a step unlocks, in document order, skipping anything inert. */
export function allowedFocusables(allowed: readonly Element[]): HTMLElement[] {
  const found = new Set<HTMLElement>();
  for (const el of allowed) {
    if (el instanceof HTMLElement && el.matches(OPERABLE)) found.add(el);
    el.querySelectorAll<HTMLElement>(OPERABLE).forEach((child) => found.add(child));
  }
  return Array.from(found)
    .filter((el) => el.isConnected && !el.closest('[inert]') && !el.hasAttribute(TOUR_NO_TAB_ATTR))
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/**
 * What the focus trap cycles through, in order: the card's buttons, the controls the step
 * unlocks inside the app (`allowed`, none for a read-only step), then the buttons of any toast
 * on screen (its action and its close button), so a toast shown during the tour can still be
 * acted on and dismissed from the keyboard.
 *
 * `allowedFirst` puts the unlocked controls before the card's buttons. Used while a task is
 * waiting to be tried: focus rests on the card itself (before the first item), so ONE Tab then
 * lands on the control the step asks for, not on "Back".
 */
export function tourFocusables(card: HTMLElement, allowed: readonly Element[] = [], allowedFirst = false): HTMLElement[] {
  const inCard = Array.from(card.querySelectorAll<HTMLElement>('button:not([disabled]), [href]'));
  const inToasts = Array.from(card.ownerDocument.querySelectorAll<HTMLElement>(`${TOUR_TOAST_SELECTOR} button:not([disabled])`));
  const inApp = allowedFocusables(allowed);
  return allowedFirst ? [...inApp, ...inCard, ...inToasts] : [...inCard, ...inApp, ...inToasts];
}

/** True for the toast container sonner renders inside the app root (a labeled live region). */
function isToastRegion(el: Element): boolean {
  return el.matches('section[aria-live]') || el.querySelector('[data-sonner-toaster]') !== null;
}

/** True when `target` is inside the app's toast region. */
export function isInToastRegion(target: Element): boolean {
  return target.closest(`${TOUR_TOAST_SELECTOR}, [data-sonner-toaster], section[aria-live]`) !== null;
}

/**
 * Locks the app under the tour: everything in the app root becomes `inert` (no clicks, no
 * drags, no focus, hidden from assistive technology) EXCEPT
 *  - the toast region: the toaster renders inside the root, so making the root itself inert
 *    would silence toast announcements and put their buttons out of reach;
 *  - the elements in `allow` (an interactive step's controls) and their ancestors. Ancestors
 *    cannot be inert, because `inert` applies to a whole subtree: instead every SIBLING along
 *    the way is, which leaves exactly the allowed controls reachable.
 *
 * `extraRoots` are surfaces outside the app root (a menu, a dialog) locked the same way.
 * Returns the undo function. Call it again whenever the page or `allow` changes: elements
 * React adds later are not inert until the next call.
 */
export function lockTourApp(allow: readonly Element[] = [], extraRoots: readonly Element[] = []): () => void {
  const locked: Element[] = [];
  const visit = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (isToastRegion(child) || allow.includes(child)) continue;
      if (allow.some((el) => child.contains(el))) {
        visit(child);
        continue;
      }
      if (!child.hasAttribute('inert')) {
        child.setAttribute('inert', '');
        locked.push(child);
      }
    }
  };
  const root = document.getElementById(TOUR_APP_ROOT_ID);
  if (root) visit(root);
  extraRoots.forEach(visit);
  return () => locked.forEach((el) => el.removeAttribute('inert'));
}

/**
 * True while a menu, popover, select list or dialog of the app is open (not the tour's card).
 * A tooltip does not count, although it is drawn in the same kind of wrapper: it takes no
 * focus and owns no keys, and one opens by itself whenever the keyboard lands on a control
 * that has one (the color dot, the star), which would otherwise read as "a menu is open" for
 * as long as focus stays there.
 */
export function isForeignLayerOpen(): boolean {
  return Array.from(document.querySelectorAll(TOUR_FOREIGN_LAYER)).some((layer) => layer.querySelector('[role="tooltip"]') === null);
}

/** True when `target` is inside such a surface. */
export function isInForeignLayer(target: Element): boolean {
  return target.closest(TOUR_CARD_SELECTOR) === null && target.closest(TOUR_FOREIGN_LAYER) !== null;
}

/** True when `target` is one of the controls the step unlocks, or inside one. */
export function isInAllowed(target: Node, allowed: readonly Element[]): boolean {
  return allowed.some((el) => el.contains(target));
}

/** True for an element the user types text into. */
export function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image'].includes(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

const canTakeFocus = (el: HTMLElement | null | undefined): el is HTMLElement =>
  !!el && el.isConnected && el !== el.ownerDocument.body && !el.closest('[inert]') && !(el as HTMLButtonElement).disabled;

/**
 * Where focus goes when the tour ends. In order: the element that had focus when the tour
 * appeared, the header's tour button, the first control in the header, the first control in
 * the app. Never `null` while the app has anything focusable, so focus cannot silently drop
 * to `<body>`. Call it after the app is unlocked: an inert element cannot take focus.
 */
export function tourFocusReturnTarget(launcher: HTMLElement | null, helpAnchor: string): HTMLElement | null {
  if (canTakeFocus(launcher)) return launcher;
  const root = document.getElementById(TOUR_APP_ROOT_ID);
  // Document order puts the header's controls first, then the rest of the app
  const candidates = [findTourAnchor(helpAnchor), ...Array.from(root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
  return candidates.find(canTakeFocus) ?? null;
}
