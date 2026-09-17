import { getDndAuxHost } from './dndGhostHost';

/**
 * App-owned assertive live region for drag outcomes that must be heard AFTER something
 * else happened: the focus move that follows a keyboard drop (NVDA/JAWS cancel speech on
 * a focus change, so an outcome announced in the same commit is lost), or a rollback
 * that happens long after dnd-kit's own end announcement.
 *
 * Lives in `#tm-dnd-aux-host` (a `<body>` child outside `#root`) and is updated with
 * plain `textContent`, so it never touches a drag source's ancestor chain (spec C4).
 */

const REGION_ID = 'tm-dnd-live-region';
let timer: ReturnType<typeof setTimeout> | null = null;

export function getDndLiveRegion(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  let region = document.getElementById(REGION_ID);
  if (!region) {
    const host = getDndAuxHost();
    if (!host) return null;
    region = document.createElement('div');
    region.id = REGION_ID;
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'assertive');
    region.setAttribute('aria-atomic', 'true');
    region.className = 'sr-only';
    host.appendChild(region);
  }
  return region;
}

/** Cancel an announcement scheduled by {@link announceDnd} that hasn't been written yet. */
export function cancelDndAnnouncement(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

/**
 * Write `text` into the region after `delayMs` (0 = now). A newer call replaces a pending
 * one. An identical message is toggled by a trailing no-break space so it is re-read.
 */
export function announceDnd(text: string, delayMs = 0): void {
  cancelDndAnnouncement();
  const write = () => {
    timer = null;
    const region = getDndLiveRegion();
    if (!region) return;
    region.textContent = region.textContent === text ? `${text} ` : text;
  };
  if (delayMs > 0) timer = setTimeout(write, delayMs);
  else write();
}
