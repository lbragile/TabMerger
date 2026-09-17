/**
 * Keyboard focus after a KEYBOARD drag ends.
 *
 * dnd-kit's own `RestoreFocus` looks the activator up by the active id. Tab and window
 * ids are POSITIONAL (`gid::w1::t2`), so after a move that id belongs to whatever item
 * now sits in the old slot — or to nothing, and focus falls to `<body>`. So the popup
 * disables `restoreFocus` and focuses explicitly, by where the item actually landed.
 *
 * Runs in an animation frame after the drop commit — never inside a native `dragstart`
 * (spec C4), and only for keyboard drags (a pointer drag leaves focus alone).
 */

const GRIP = '[aria-label^="Drag to reorder"]';

const rowSel = (id: string) => `[data-tm-dnd-id="${id.replace(/["\\]/g, '\\$&')}"]`;

/** Candidates (best first) that put focus ON a tab/window model id: its grip, else the row. */
export function focusSelectorsForItem(id: string): string[] {
  if (/::w\d+::t\d+$/.test(id)) return [`${rowSel(id)} ${GRIP}`, rowSel(id)];
  if (/::w\d+$/.test(id)) {
    // A group's ONLY window renders no grip: land on its header's first real control
    // (checkbox / note / star / menu — the hidden context-menu trigger is aria-hidden)
    // before falling back to its first tab row.
    return [
      `${rowSel(id)} [aria-label^="Drag to reorder window"]`,
      `${rowSel(id)} [data-window-header] button:not([aria-hidden="true"])`,
      `${rowSel(id)} [role="listitem"]`
    ];
  }
  return [];
}

/** Candidates for a sidebar group row at `index`: its grip, else the row itself. */
export function focusSelectorsForGroupIndex(index: number): string[] {
  return [`[data-sidebar-group-index="${index}"] ${GRIP}`, `[data-sidebar-group-index="${index}"]`];
}

/**
 * The nearest item that REMAINS where `id` was (the item left the visible panel): the
 * row that took its slot, the one before it, then its window, the window before, and
 * finally the visible group's sidebar row.
 */
export function focusSelectorsNear(id: string, fallbackGroupIndex: number): string[] {
  const out: string[] = [];
  const tab = /^(.*)::w(\d+)::t(\d+)$/.exec(id);
  const win = tab ? null : /^(.*)::w(\d+)$/.exec(id);
  const gid = tab?.[1] ?? win?.[1];
  const wi = Number(tab?.[2] ?? win?.[2]);
  if (tab) {
    const ti = Number(tab[3]);
    out.push(...focusSelectorsForItem(`${gid}::w${wi}::t${ti}`));
    if (ti > 0) out.push(...focusSelectorsForItem(`${gid}::w${wi}::t${ti - 1}`));
  }
  if (gid !== undefined) {
    out.push(...focusSelectorsForItem(`${gid}::w${wi}`));
    if (wi > 0) out.push(...focusSelectorsForItem(`${gid}::w${wi - 1}`));
  }
  out.push(...focusSelectorsForGroupIndex(fallbackGroupIndex));
  return out;
}

/** Focus the first connected, focusable match. Returns the focused element, or null. */
export function focusFirst(selectors: string[], root: ParentNode = document): HTMLElement | null {
  for (const sel of selectors) {
    let el: HTMLElement | null = null;
    try {
      el = root.querySelector<HTMLElement>(sel);
    } catch {
      continue;
    }
    if (!el || el.closest('#tm-dnd-aux-host')) continue;
    el.focus();
    if (document.activeElement === el) return el;
  }
  return null;
}

/**
 * {@link focusFirst} in the next animation frame, retried once a frame later (the commit may
 * still be rendering). `onDone` runs once the attempt is over, with the focused element (or
 * `null` when nothing matched) — e.g. to announce the outcome only AFTER focus has moved.
 */
export function focusAfterDrop(selectors: string[], onDone?: (el: HTMLElement | null) => void): void {
  if (selectors.length === 0) {
    onDone?.(null);
    return;
  }
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 16);
  raf(() => {
    const el = focusFirst(selectors);
    if (el) {
      onDone?.(el);
      return;
    }
    raf(() => {
      // NOT `onDone?.(focusFirst(…))`: an optional call skips evaluating its argument.
      const late = focusFirst(selectors);
      onDone?.(late);
    });
  });
}
